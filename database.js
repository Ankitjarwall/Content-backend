const fs = require('fs-extra');
const path = require('path');

const DB_PATH = path.join(__dirname, 'db.json');

const defaultDb = {
    posts: {}, // shortcode -> { status: 'pending' | 'approved' | 'rejected' | 'uploaded', ... }

    // Communities list for sharing (Reference Data)
    communities: [],

    // Configuration Profiles
    profiles: [
        {
            id: 'default',
            name: 'Default Profile',
            communityId: '',
            instagramUsernames: ['strangerthingstv'],
            scrapeLimit: 10,
            isActive: true
        }
    ],

    // Active profile ID
    activeProfileId: 'default'
};

async function initDb() {
    if (!await fs.exists(DB_PATH)) {
        await fs.writeJson(DB_PATH, defaultDb, { spaces: 2 });
    }
}

async function getDb() {
    return await fs.readJson(DB_PATH);
}

async function saveDb(data) {
    await fs.writeJson(DB_PATH, data, { spaces: 2 });
}

module.exports = {
    initDb,
    getDb,
    saveDb
};
