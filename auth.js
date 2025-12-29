const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const SESSION_FILE = path.join(__dirname, 'session.json');

async function login() {
    try {
        const response = await axios.post(`${config.BASE_URL}/auth/user/login`, {
            email: config.EMAIL,
            password: config.PASSWORD,
            platform: config.PLATFORM
        });

        if (response.data && response.data.token) {
            console.log('Login successful. User ID:', response.data.user._id);
            const session = {
                token: response.data.token,
                refreshToken: response.data.refreshToken,
                user: response.data.user,
                timestamp: Date.now()
            };
            fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
            console.log('Login successful. Session saved.');
            return session;
        } else {
            throw new Error('Login failed: ' + JSON.stringify(response.data));
        }
    } catch (error) {
        console.error('Login Error:', error.response ? error.response.data : error.message);
        throw error;
    }
}

async function refreshTokens(refreshToken) {
    try {
        const response = await axios.post(`${config.BASE_URL}/auth/user/regenerateAccessToken`, {
            refreshToken: refreshToken,
            platform: config.PLATFORM
        });

        if (response.data && response.data.newAccessToken) {
            const session = getSession();
            session.token = response.data.newAccessToken;
            session.refreshToken = response.data.newRefreshToken;
            session.timestamp = Date.now();
            fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
            console.log('Tokens refreshed successfully.');
            return session;
        } else {
            throw new Error('Refresh failed: ' + JSON.stringify(response.data));
        }
    } catch (error) {
        console.error('Refresh Error:', error.response ? error.response.data : error.message);
        throw error;
    }
}

function getSession() {
    if (fs.existsSync(SESSION_FILE)) {
        return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    }
    return null;
}

async function getValidToken() {
    let session = getSession();

    if (!session) {
        console.log('No session found, logging in...');
        session = await login();
        return session.token;
    }

    // Token expires in 25 mins. Let's refresh if older than 20 mins.
    const now = Date.now();
    const tokenAgeMs = now - session.timestamp;
    const twentyMinutesMs = 20 * 60 * 1000;

    if (tokenAgeMs > twentyMinutesMs) {
        console.log('Token is old, refreshing...');
        try {
            session = await refreshTokens(session.refreshToken);
        } catch (err) {
            console.log('Refresh failed, logging in again...');
            session = await login();
        }
    }

    return session.token;
}

// Force a fresh login (useful when getting 401/404 errors)
async function forceLogin() {
    console.log('Forcing fresh login...');
    const session = await login();
    return session.token;
}

module.exports = {
    login,
    refreshTokens,
    getSession,
    getValidToken,
    forceLogin
};
