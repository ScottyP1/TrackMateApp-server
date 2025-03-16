const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');

const Track = mongoose.model('Track');
const router = express.Router();

router.get('/Tracks', async (req, res) => {
    let { zipCode, trackName, lat, lng, radius = 80467 } = req.query; // Default radius is 50 miles (in meters)

    // Check if we have at least one valid search parameter (zip, trackName, or lat/lng)
    if (!zipCode && !trackName && (!lat || !lng)) {
        return res.status(400).json({ message: 'Please provide a track name, zip code, or location.' });
    }
    console.log(zipCode)
    try {
        // If the trackName is provided
        if (trackName) {
            const sanitizedTrackName = escapeRegExp(trackName);
            const tracks = await Track.find({
                name: { $regex: sanitizedTrackName, $options: 'i' }
            }).lean();
            if (tracks.length === 0) {
                return res.status(404).json({ message: 'No tracks found with that name.' });
            }

            return res.json({ tracks });
        }

        // If zipCode is provided, convert it to lat/lng (geocode it)
        if (zipCode) {
            const userLocation = await geocodeZipCode(zipCode); // Assuming this returns { lat, lng }

            if (!userLocation) {
                return res.status(404).json({ message: 'No tracks found in this area.' });
            }
            lat = userLocation.lat;
            lng = userLocation.lng;
        }

        // If lat/lng is provided (either from location services or geocoding), use it to search for nearby tracks
        if (lat && lng) {
            // Convert radius to number if it's provided as a string
            radius = parseFloat(radius);

            const tracks = await Track.find({
                coordinates: {
                    $near: {
                        $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
                        $maxDistance: radius  // Limit search to the radius provided (default to 50 miles)
                    }
                }
            }).lean();

            if (tracks.length === 0) {
                return res.status(404).json({ message: 'No tracks found in this area.' });
            }
            return res.json({ tracks, lat, lng });
        }

        // If nothing matches, return an error
        return res.status(400).json({ message: 'Invalid search parameters provided.' });

    } catch (error) {
        console.error('Error fetching tracks:', error);
        return res.status(500).json({ error: 'Failed to fetch tracks.' });
    }
});

router.get('/tracks/byIds', async (req, res) => {
    const { ids } = req.query;

    if (!ids) {
        return res.status(400).json({ message: 'Please provide track IDs.' });
    }

    try {
        // Convert to an array (handles both single and multiple IDs)
        const trackIds = ids.split(',').map(id => mongoose.Types.ObjectId.createFromHexString(id));

        const tracks = await Track.find({ _id: { $in: trackIds } }).lean();

        if (tracks.length === 0) {
            return res.status(404).json({ message: 'No tracks found for the given ID(s).' });
        }

        return res.json(tracks);

    } catch (error) {
        console.error('Error fetching tracks by ID(s):', error);
        return res.status(500).json({ error: 'Failed to fetch track(s).' });
    }
});

router.patch('/track', async (req, res) => {
    const { id } = req.query; // Track ID from query
    let { announcement } = req.body; // Updated announcement from body

    if (!id || !announcement) {
        return res.status(400).json({ message: 'Please provide a track ID and the updated announcement.' });
    }

    try {
        announcement = announcement.trim();

        if (!announcement || announcement.length < 3) {
            return res.status(400).json({ message: 'Announcement is too short.' });
        }

        // Convert ID to ObjectId
        const trackId = new mongoose.Types.ObjectId(id);

        // Update the track's announcement field
        const updatedTrack = await Track.findByIdAndUpdate(
            trackId,
            { $set: { announcement } },
            { new: true } // Return the updated document
        ).lean();

        if (!updatedTrack) {
            return res.status(404).json({ message: 'Track not found.' });
        }

        return res.json(updatedTrack);
    } catch (error) {
        console.error('Error updating track announcement:', error);
        return res.status(500).json({ error: 'Failed to update track announcement.' });
    }
});

module.exports = router;


// Escape regex special characters in the track name
function escapeRegExp(string) {
    return string.replace(/[.*+?^=!:${}()|\[\]\/\\]/g, '\\$&');
}

async function geocodeZipCode(zipCode) {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;  // Replace with your API key
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${zipCode}&key=${apiKey}`;

    try {
        const response = await axios.get(url);
        const location = response.data.results[0]?.geometry.location;
        if (location) {
            return { lat: location.lat, lng: location.lng };
        }
        return null;
    } catch (error) {
        console.error('Error geocoding zip code:', error);
        return null;
    }
}