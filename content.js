const axios = require('axios');
const config = require('./config');
const auth = require('./auth');

async function createCommunityPost(data) {
    const { contentType, s3Key, videoUrl, text, communityId, aspectRatio } = data;
    try {
        // Get fresh token
        const token = await auth.forceLogin();
        const axiosConfig = {
            headers: {
                authorization: `Bearer ${token}`
            }
        };

        // Step 1: Create Content
        let url = s3Key;
        let c_url = undefined;

        if (contentType === 'video') {
            url = ''; // Empty for video
            c_url = s3Key; // S3 key goes here
        } else if (contentType === 'image') {
            const ar = aspectRatio || '1';
            url = `${s3Key}#${ar}`;
        }

        const contentBody = {
            contentType: contentType,
            url: url,
            ...(c_url && { c_url }), // Only include c_url if provided
            text: text || '',
            sendBy: 'userCommunity',
            belongsTo: communityId,
            key: 'normal',
            peopleTagged: [],
            tags: [],
            universeMetaData: {}
        };

        console.log('\n========== CREATE CONTENT REQUEST ==========');
        console.log('URL:', `${config.BASE_URL}/content/createContent`);
        console.log('Body:', JSON.stringify(contentBody, null, 2));

        const contentResponse = await axios.post(`${config.BASE_URL}/content/createContent`, contentBody, axiosConfig);

        console.log('Response:', JSON.stringify(contentResponse.data, null, 2));

        const contentId = contentResponse.data.contentId;

        if (!contentId) {
            throw new Error('Failed to get contentId: ' + JSON.stringify(contentResponse.data));
        }

        console.log('Content created successfully. ID:', contentId);

        // Step 3: Finalize Post
        const postBody = {
            communityId: communityId,
            contentId: contentId,
            contentType: contentType,
            actionHandled: true
        };

        console.log('\n========== FINALIZE POST REQUEST ==========');
        console.log('Body:', JSON.stringify(postBody, null, 2));

        const postResponse = await axios.post(`${config.BASE_URL}/community/post`, postBody, axiosConfig);
        console.log('Post finalized in community successfully.');

        return postResponse.data;
    } catch (error) {
        console.error('\n========== CREATE POST ERROR ==========');
        if (error.response && error.response.data) {
            console.error('Status:', error.response.status);
            console.error('Response Data:', JSON.stringify(error.response.data, null, 2));
        }
        console.error('Error Message:', error.message);
        throw error;
    }
}

async function createClubPost(data) {
    const { contentType, s3Key, videoUrl, text, clubId, aspectRatio, publicMode } = data;
    try {
        const token = await auth.getValidToken();
        const axiosConfig = {
            headers: {
                authorization: `Bearer ${token}`
            }
        };

        let url = s3Key;
        let c_url = undefined;

        if (contentType === 'video') {
            url = '';
            c_url = s3Key;
        } else if (contentType === 'image') {
            const ar = aspectRatio || '1';
            url = `${s3Key}#${ar}`;
        }

        const contentBody = {
            contentType: contentType,
            url: url,
            ...(c_url && { c_url }),
            text: text || '',
            sendBy: 'club',
            belongsTo: clubId,
            key: 'normal',
            peopleTagged: [],
            tags: [],
            universeMetaData: {},
            template: ''
        };

        const contentResponse = await axios.post(`${config.BASE_URL}/content/createContent`, contentBody, axiosConfig);
        const contentId = contentResponse.data.contentId;

        if (!contentId) {
            throw new Error('Failed to get contentId: ' + JSON.stringify(contentResponse.data));
        }

        console.log('Club content created successfully. ID:', contentId);

        const postBody = {
            clubId: clubId,
            contentId: contentId,
            publicMode: publicMode || false
        };

        await axios.post(`${config.BASE_URL}/club/postContent`, postBody, axiosConfig);
        await axios.get(`${config.BASE_URL}/club/updateRating?clubId=${clubId}`, axiosConfig);

        console.log('Club post finalized successfully.');
        return true;
    } catch (error) {
        console.error('Create Club Post Error:', error.response ? error.response.data : error.message);
        throw error;
    }
}

module.exports = {
    createCommunityPost,
    createClubPost
};
