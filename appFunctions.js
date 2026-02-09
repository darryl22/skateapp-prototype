const nodemailer = require("nodemailer")
const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
})

class appFunctions{
    async sendPrimaryMail(receiver, subject, content) {
        try {
            const info = await transporter.sendMail({
                from: "skatetopicke@gmail.com",
                to: receiver,
                subject: subject,
                text: "",
                html: content
            })
            // console.log(info.messageId)
            // console.log(info)
            return info
        } catch(error) {
            console.log(error)
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