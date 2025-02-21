const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');

const Track = mongoose.model('Track');
const router = express.Router();

router.get('/Tracks', async (req, res) => {
    let { zipCode, trackName, lat, lng, radius = 80467, page = 1, limit = 10 } = req.query;

    page = parseInt(page, 10);
    limit = parseInt(limit, 10);

    if (!zipCode && !trackName && (!lat || !lng)) {
        return res.status(400).json({ message: 'Please provide a track name, zip code, or location.' });
    }

    try {
        let query = {};

        if (trackName) {
            query.name = { $regex: escapeRegExp(trackName), $options: 'i' };
        }

        if (zipCode) {
            const userLocation = await geocodeZipCode(zipCode);
            if (!userLocation) {
                return res.status(404).json({ message: 'No tracks found in this area.' });
            }
            lat = userLocation.lat;
            lng = userLocation.lng;
        }

        if (lat && lng) {
            query.coordinates = {
                $near: {
                    $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
                    $maxDistance: parseFloat(radius)
                }
            };
        }

        // **Get total count before applying pagination**
        const totalTracks = await Track.countDocuments(query);

        const tracks = await Track.find(query)
            .skip((page - 1) * limit)
            .limit(limit)
            .lean();

        return res.json({
            tracks,
            totalCount: totalTracks, // Total number of matching tracks
            currentPage: page,
            totalPages: Math.ceil(totalTracks / limit),
            hasMore: page * limit < totalTracks
        });

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