const express = require('express');
require('dotenv').config();
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const db = require('./database');
const auth = require('./auth');
const { uploadToS3 } = require('./upload');
const { createCommunityPost } = require('./content');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Initialize Database
db.initDb();

// --- API Endpoints ---

// Health Check
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'active',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Get all posts (merged with status)
app.get('/api/posts', async (req, res) => {
    try {
        const resultsDir = path.join(__dirname, 'results');
        if (!await fs.exists(resultsDir)) {
            return res.json([]);
        }

        const files = await fs.readdir(resultsDir);
        const jsonFiles = files.filter(f => f.endsWith('_posts.json'));

        let allPosts = [];
        const database = await db.getDb();

        for (const file of jsonFiles) {
            const data = await fs.readJson(path.join(resultsDir, file));
            allPosts = allPosts.concat(data);
        }

        // Merge with status from DB
        const mergedPosts = allPosts.map(post => ({
            ...post,
            status: database.posts[post.shortcode]?.status || 'pending'
        }));

        res.json(mergedPosts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update post status (Approve/Reject)
app.post('/api/posts/status', async (req, res) => {
    const { shortcode, status } = req.body;
    try {
        const database = await db.getDb();
        database.posts[shortcode] = {
            ...(database.posts[shortcode] || {}),
            status
        };
        await db.saveDb(database);

        // If approved, trigger upload flow
        if (status === 'approved') {
            handleUpload(shortcode).catch(err => console.error('Upload flow error:', err));
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Settings Endpoints - Get all config
app.get('/api/settings', async (req, res) => {
    const database = await db.getDb();
    const activeProfileId = database.activeProfileId || 'default';
    const activeProfile = (database.profiles || []).find(p => p.id === activeProfileId) || {};

    res.json({
        // Return active profile settings as top-level for frontend compatibility
        instagramUsernames: activeProfile.instagramUsernames || [],
        scrapeLimit: activeProfile.scrapeLimit || 10,
        communities: database.communities || [],
        profiles: database.profiles || [],
        activeProfileId: database.activeProfileId || 'default'
    });
});

// Update settings
app.post('/api/settings', async (req, res) => {
    try {
        const database = await db.getDb();
        const { instagramUsernames, scrapeLimit, communities, profiles, activeProfileId } = req.body;

        // Handle global fields
        if (communities !== undefined) database.communities = communities;
        if (profiles !== undefined) database.profiles = profiles;
        if (activeProfileId !== undefined) database.activeProfileId = activeProfileId;

        // Sync current UI fields to active profile
        const currentProfileId = activeProfileId || database.activeProfileId || 'default';
        const profileIndex = database.profiles.findIndex(p => p.id === currentProfileId);
        if (profileIndex !== -1) {
            if (instagramUsernames !== undefined) database.profiles[profileIndex].instagramUsernames = instagramUsernames;
            if (scrapeLimit !== undefined) database.profiles[profileIndex].scrapeLimit = scrapeLimit;
        }

        await db.saveDb(database);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Trigger Scrape
app.post('/api/scrape', async (req, res) => {
    try {
        const database = await db.getDb();
        const activeProfileId = database.activeProfileId || 'default';
        const activeProfile = (database.profiles || []).find(p => p.id === activeProfileId);

        const usernames = activeProfile?.instagramUsernames || [];
        const limit = activeProfile?.scrapeLimit || 10;
        const pythonPath = process.platform === 'win32' ? 'python' : 'python3';
        const scraperPath = path.join(__dirname, 'scraper.py');

        console.log('\n========== START SCRAPE FLOW ==========');
        console.log('Active Profile:', activeProfileId);
        console.log('Usernames:', usernames);
        console.log('Limit:', limit);
        console.log('Python Path:', pythonPath);

        if (usernames.length === 0) {
            console.log('ERROR: No usernames configured');
            return res.status(400).json({ error: 'No usernames configured. Add usernames in Settings.' });
        }

        // Scrape each username
        usernames.forEach(username => {
            console.log(`\n[${username}] Spawning scraper...`);
            const args = [scraperPath, username, '--limit', limit.toString()];

            if (process.env.INSTAGRAM_USER &&
                process.env.INSTAGRAM_PASSWORD &&
                !process.env.INSTAGRAM_USER.includes('your_instagram_username')) {
                args.push('--login_user', process.env.INSTAGRAM_USER);
                args.push('--login_pass', process.env.INSTAGRAM_PASSWORD);
            }

            console.log(`[${username}] Args:`, args.map(a => a.includes(process.env.INSTAGRAM_PASSWORD) ? '***' : a));
            const child = spawn(pythonPath, args);

            child.stdout.on('data', (data) => {
                console.log(`[${username}] ${data.toString().trim()}`);
            });

            child.stderr.on('data', (data) => {
                console.log(`[${username}] ERR: ${data.toString().trim()}`);
            });

            child.on('close', (code) => {
                console.log(`[${username}] Scraper finished with code ${code}`);
            });

            child.on('error', (err) => {
                console.error(`[${username}] Failed to start scraper:`, err.message);
            });
        });

        res.json({ success: true, message: `Scraping started for ${usernames.length} users` });
    } catch (error) {
        console.error('Scrape error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Share post to a specific community
app.post('/api/share', async (req, res) => {
    const { shortcode, communityId } = req.body;
    console.log('\n========== SHARE REQUEST START ==========');
    console.log('Shortcode:', shortcode);
    console.log('Community ID:', communityId);

    if (!shortcode || !communityId) {
        return res.status(400).json({ error: 'shortcode and communityId required' });
    }

    try {
        // Find the post
        const database = await db.getDb();
        const resultsDir = path.join(__dirname, 'results');
        const files = await fs.readdir(resultsDir);
        const jsonFiles = files.filter(f => f.endsWith('_posts.json'));

        let post = null;
        for (const file of jsonFiles) {
            const data = await fs.readJson(path.join(resultsDir, file));
            post = data.find(p => p.shortcode === shortcode);
            if (post) break;
        }

        if (!post) {
            console.error('Post not found in local JSON files.');
            return res.status(404).json({ error: 'Post not found in results' });
        }

        console.log('Post Type:', post.is_video ? 'VIDEO' : 'IMAGE');

        // Force a fresh login to ensure valid JWT token
        console.log('Getting fresh auth token...');
        await auth.forceLogin();

        // Download, upload, and share
        const tempDir = path.join(__dirname, 'temp');
        await fs.ensureDir(tempDir);
        const mediaUrl = post.is_video ? post.video_url : post.display_url;
        const extension = post.is_video ? '.mp4' : '.jpg';
        const filePath = path.join(tempDir, `${shortcode}${extension}`);

        console.log(`Downloading ${mediaUrl} to ${filePath}...`);
        const response = await axios({
            url: mediaUrl,
            method: 'GET',
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        const stats = await fs.stat(filePath);
        const fileSizeMB = stats.size / (1024 * 1024);
        console.log(`Downloaded file size: ${fileSizeMB.toFixed(2)} MB`);

        const maxSizeMB = post.is_video ? 50 : 10;
        if (fileSizeMB > maxSizeMB) {
            console.error(`File exceeds limit: ${fileSizeMB.toFixed(1)}MB > ${maxSizeMB}MB`);
            await fs.remove(filePath);
            return res.status(413).json({
                error: `File too large (${fileSizeMB.toFixed(1)}MB). Max allowed: ${maxSizeMB}MB for ${post.is_video ? 'videos' : 'images'}.`
            });
        }

        // Upload to S3
        const s3Key = await uploadToS3(filePath);
        // Cleanup temp file
        await fs.remove(filePath);

        // Create community post
        console.log('Creating community post with S3 key:', s3Key);
        await createCommunityPost({
            contentType: post.is_video ? 'video' : 'image',
            s3Key: s3Key,
            text: post.caption || '',
            communityId: communityId,
            aspectRatio: '1'
        });

        // Track as shared
        database.posts[shortcode] = {
            ...(database.posts[shortcode] || {}),
            status: 'uploaded',
            sharedTo: [...(database.posts[shortcode]?.sharedTo || []), communityId]
        };
        await db.saveDb(database);

        // Cleanup
        await fs.remove(filePath);
        console.log('========== SHARE REQUEST SUCCESS ==========');

        res.json({ success: true, message: `Shared to community ${communityId}` });
    } catch (error) {
        console.error('Share error:', error.response?.data || error.message);
        res.status(500).json({ error: error.message });
    }
});

// --- Helper Functions ---

async function handleUpload(shortcode) {
    console.log('\n========== AUTO UPLOAD START ==========');
    console.log('Shortcode:', shortcode);

    try {
        const database = await db.getDb();
        const resultsDir = path.join(__dirname, 'results');
        const files = await fs.readdir(resultsDir);
        const jsonFiles = files.filter(f => f.endsWith('_posts.json'));

        let post = null;
        for (const file of jsonFiles) {
            const data = await fs.readJson(path.join(resultsDir, file));
            post = data.find(p => p.shortcode === shortcode);
            if (post) break;
        }

        if (!post) throw new Error('Post not found');
        console.log('Post Metadata Loaded.');

        // 1. Download media
        const tempDir = path.join(__dirname, 'temp');
        await fs.ensureDir(tempDir);
        const mediaUrl = post.is_video ? post.video_url : post.display_url;
        const extension = post.is_video ? '.mp4' : '.jpg';
        const filePath = path.join(tempDir, `${shortcode}${extension}`);

        console.log(`Downloading ${mediaUrl} to temp file...`);
        const response = await axios({
            url: mediaUrl,
            method: 'GET',
            responseType: 'stream'
        });

        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        const stats = await fs.stat(filePath);
        console.log('File Downloaded. Size:', (stats.size / (1024 * 1024)).toFixed(2), 'MB');

        // 2. Upload to S3
        const s3Key = await uploadToS3(filePath);

        // 3. Create Community Post
        const activeProfileId = database.activeProfileId || 'default';
        const activeProfile = (database.profiles || []).find(p => p.id === activeProfileId);

        if (!activeProfile || !activeProfile.communityId) {
            throw new Error(`No active profile or community ID found for ${activeProfileId}`);
        }

        console.log('Creating Community Post in:', activeProfile.communityId);
        await createCommunityPost({
            contentType: post.is_video ? 'video' : 'image',
            s3Key: s3Key,
            text: post.caption || '',
            communityId: activeProfile.communityId,
            aspectRatio: '1'
        });

        // 4. Update status to uploaded
        database.posts[shortcode].status = 'uploaded';
        await db.saveDb(database);

        // Cleanup
        await fs.remove(filePath);
        console.log('========== AUTO UPLOAD SUCCESS ==========');

    } catch (error) {
        console.error('AUTO UPLOAD FAILED:', error.response?.data || error.message);
        const database = await db.getDb();
        if (database.posts[shortcode]) {
            database.posts[shortcode].status = 'failed';
            await db.saveDb(database);
        }
    }
}

// Proxy for Instagram Images (to bypass CORS/Hotlinking)
app.get('/api/proxy', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('URL is required');

    try {
        const response = await axios({
            url: url,
            method: 'GET',
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (response.headers['content-type']) {
            res.setHeader('Content-Type', response.headers['content-type']);
        }

        response.data.pipe(res);
    } catch (error) {
        res.status(500).send('Error proxying image');
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
