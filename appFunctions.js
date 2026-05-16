const nodemailer = require("nodemailer")
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: process.env.EMAIL_SECURE === "true",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
})

class appFunctions{
    async sendPrimaryMail(receiver, subject, content) {
        try {
            const info = await transporter.sendMail({
                from: process.env.EMAIL_USER,
                to: receiver,
                subject: subject,
                text: "",
                html: content
            })
            return info
        } catch(error) {
            return "Error sending mail"
        }
    }

    generateToken(length) {
        let values = "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"
        let resultString = ""
        for (let x = 0; x < length; x++) {
            let index = Math.floor(Math.random() * values.length)
            resultString = resultString + values[index]
        }
        return resultString
    }
}

module.exports = appFunctions