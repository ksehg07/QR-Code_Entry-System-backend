const mongoose = require('mongoose');

const RegistrationSchema = new mongoose.Schema({
    name: String,
    email: String,
    phone: String,
    collegeId: String,
    stream: String,
    semester: String,
    qrCode: String,
    attended: {
        type: Boolean,
        default: false,
    },
}, { timestamps: true});

module.exports = mongoose.model('Registration', RegistrationSchema);
