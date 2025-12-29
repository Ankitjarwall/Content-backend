const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const config = require('./config');
const auth = require('./auth');

async function uploadToS3(filePath) {
    console.log('\n========== S3 UPLOAD START ==========');
    console.log('File Path:', filePath);
    try {
        const stats = fs.statSync(filePath);
        console.log('File Size:', (stats.size / (1024 * 1024)).toFixed(2), 'MB');

        const token = await auth.getValidToken();
        const form = new FormData();
        form.append('file', fs.createReadStream(filePath));

        const uploadUrl = `${config.BASE_URL}/content/uploadToS3`;
        console.log('Upload URL:', uploadUrl);

        const headers = {
            ...form.getHeaders(),
            'authorization': `Bearer ${token}`
        };
        console.log('Headers:', JSON.stringify({ ...headers, authorization: 'Bearer [HIDDEN]' }, null, 2));

        const response = await axios.post(uploadUrl, form, {
            headers: headers,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        console.log('S3 Upload Response Status:', response.status);
        console.log('S3 Upload Response Body:', JSON.stringify(response.data, null, 2));

        if (response.data && response.data.success) {
            console.log('File uploaded to S3 successfully. Key:', response.data.key);
            return response.data.key;
        } else {
            throw new Error('Upload failed: ' + JSON.stringify(response.data));
        }
    } catch (error) {
        console.error('\n========== S3 UPLOAD ERROR ==========');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
            console.error('Headers:', JSON.stringify(error.response.headers, null, 2));
        } else {
            console.error('Error Message:', error.message);
        }
        throw error;
    }
}

module.exports = {
    uploadToS3
};
