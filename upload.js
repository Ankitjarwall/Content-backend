const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const config = require('./config');
const auth = require('./auth');

async function uploadToS3(filePath) {
    try {
        const token = await auth.getValidToken();
        const form = new FormData();
        form.append('file', fs.createReadStream(filePath));

        const response = await axios.post(`${config.BASE_URL}/content/uploadToS3`, form, {
            headers: {
                ...form.getHeaders(),
                'authorization': `Bearer ${token}`
            }
        });

        if (response.data && response.data.success) {
            console.log('File uploaded to S3 successfully. Key:', response.data.key);
            return response.data.key;
        } else {
            throw new Error('Upload failed: ' + JSON.stringify(response.data));
        }
    } catch (error) {
        console.error('Upload Error:', error.response ? error.response.data : error.message);
        throw error;
    }
}

module.exports = {
    uploadToS3
};
