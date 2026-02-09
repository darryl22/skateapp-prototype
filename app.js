const express = require("express")
const app = express()
const port = 3000
require("dotenv").config()
const bodyParser = require("body-parser")
const fs = require("fs")

const Cryptr = require("cryptr")
const cryptr = new Cryptr(process.env.ENCRYPTION_KEY)
const cors = require("cors")
const session = require("express-session")
const {ObjectId} = require("mongodb")
const MongoDBStore  = require("connect-mongodb-session")(session)
const store = new MongoDBStore ({
    uri: "mongodb://localhost:27017/skateapp",
    databaseName: "skateapp",
    collection: "mySessions"
})

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

// const uri = process.env.MONGO_URI
// const client = new MongoClient(uri)
const DatabaseMethods = require("./dbFunctions")
const appFunctions = require("./appFunctions")
const { error } = require("console")
const africastalking = require("africastalking")
let databaseMethods = new DatabaseMethods()
let appFuncs = new appFunctions()
const ExpressSanitizer = require("perfect-express-sanitizer")

app.set('view engine', 'ejs')
app.use(express.static('public'))
app.use(express.json())
app.use(bodyParser.urlencoded({extended: true, limit: "300mb"}))
app.use(require("express-session")({
    secret: process.env.SESSION_SECRET,
    cookie: {
        maxAge: 604800000
    },
    store: store,
    resave: true,
    saveUninitialized: true
}))
app.use(cors({
    origin: ["localhost:3001", "9d240f47a4b9.ngrok-free.app"]
}))

app.use((request, response, next) => {
    console.log(request.path)
    next()
})

app.get('/', async (request, response) => {
    if (request.session.user === undefined) {
        request.session.user = "anonymous"
    } else {
        response.locals.user = request.session.user
    }
    // let content = "<h1>Test Content</h1> <p style='color: blue;'>This is new test content</p>"
    // let mailresult = await appFuncs.sendPrimaryMail("darrylandrew22@gmail.com", "Test mail", content)
    // console.log(mailresult)
    // console.log(mailresult.messageId)
    response.render('index.ejs', {user: request.session.user})
})

app.get('/getUser', async (request, response) => {
    if (request.session.user === undefined) {
        response.json({status: "Error getting user", user: "anonymous"})
    }else {
        // await databaseMethods.getOne("users", {username: request.session.user})
        // .then(res => {
        //     console.log(res)
        // })
        // .catch(error => {
        //     console.log(error)
        // })
        response.json({user: request.session.user})
    }
})

app.get('/map', async (request, response) => {
    console.log(request.session.userID)
    await Promise.all([databaseMethods.getMany("spots"), databaseMethods.getOne("users", {username: request.session.user})])
    .then(res => {
        // console.log(res[1])
        let userObject = {
            username: "anonymous",
        }
        if (res[1] !== null) {
            userObject.username = res[1].username
            userObject.preferences = res[1].preferences
        }
        response.render('map.ejs', {mapboxtoken : process.env.MAPBOX_ACCESS_TOKEN, userObject: userObject, spots: res[0], user: request.session.user})
    })
    .catch(error => {
        console.log(error)
        response.redirect("/")
    })
})

app.post('/addspot', async (request, response) => {
    const date = new Date()
    const options = { xss: true, noSql: true, sql: true, level: 5 }
    let sanitizedDesc = ExpressSanitizer.sanitize.prepareSanitize(request.body.description, options)
    console.log(sanitizedDesc)
    let data = {
        description: sanitizedDesc,
        spottype: request.body.spottype,
        longitude: request.body.lng,
        latitude: request.body.lat,
        spotimages: request.body.spotimages,
        createdAt: date,
        createdBy: request.session.user,
        interactions: {
            likes: [],
            comments: []
        }
    }

    for (x of data.spotimages) {
        console.log(x.length)
    }
    await databaseMethods.addOne("spots", data)
    .then( async res => {
        await databaseMethods.getOne("spots", {_id: res.insertedId})
        .then(spot => {
            // console.log(spot)
            response.json({status: "SUCCESS", message: "New spot added", newSpot: res.insertedId})
        })
        .catch(error => {
            console.log(error)
            response.json({status: "ERROR", message: "Error getting created item, please reload page"})
        })
    })
    .catch(error => {
        console.log(error)
        response.json({status: "ERROR", message: "There was an error, please try again"})
    })

    // response.redirect("/map")
})

app.get('/getSpot', async (request, response) => {
    console.log(request.query)
    try{
        let spotID = ObjectId.createFromHexString(request.query.spotID)
        await databaseMethods.getOne("spots", {_id: spotID})
        .then(res => {
            if(res !== null) {
                response.json({status: "SUCCESS", message: "Reference received", spot: res})
            } else {
                response.json({status: "ERROR", message: "Spot not found", spot: res})
            }
        })
        .catch(error => {
            console.log(error)
            response.json({status: "ERROR", message: "There was an error getting spot"})
        })
    } catch(error) {
        response.json({status: "ERROR", message: "Invalid reference"})
    }
})

app.post('/updateComment', async (request, response) => {
    // console.log(request.body)
    let spotID = ObjectId.createFromHexString(request.body.spotID)
    try {
        await databaseMethods.getOne("spots", {_id: spotID})
        .then(async spotRes => {
            // console.log(spotRes)
            if(request.body.type === "newComment") {
                let newID = new ObjectId()
                await databaseMethods.makeUpdate("spots", {_id: spotID}, {
                    $push: {
                        "interactions.comments": {
                            commentID: newID.toHexString(),
                            content: request.body.comment,
                            author: request.session.userID,
                            replies: []
                        }
                    }
                })
                .then(async commentRes => {
                    console.log(commentRes)
                    let spot = await databaseMethods.getOne("spots", {_id: spotID})
                    response.json({status: "SUCCESS", message: "Added comment", spot: spot})
                })
                .catch(error => {
                    console.log(error)
                    response.json({status: "SUCCESS", message: "Error adding comment"})
                })
            } else if (request.body.type === "reply") {
                let newID = new ObjectId()
                for (let x = 0; x < spotRes.interactions.comments.length; x++) {
                    if (spotRes.interactions.comments[x].commentID === request.body.replyId) {
                        let queryObject = {}
                        queryObject[`interactions.comments.${x}.replies`] = {
                            commentID: newID.toHexString(),
                            content: request.body.comment,
                            author: request.session.userID,
                        }
                        await databaseMethods.makeUpdate("spots", {_id: spotID}, {
                            $push: queryObject
                        })
                        .then(async commentRes => {
                            console.log(commentRes)
                            let spot = await databaseMethods.getOne("spots", {_id: spotID})
                            response.json({status: "SUCCESS", message: "Added comment", spot: spot})
                        })
                        .catch(error => {
                            console.log(error)
                            response.json({status: "SUCCESS", message: "Error adding comment"})
                        })
                    }
                }
            }
        })
        .catch(error => {
            console.log(error)
            response.json({status: "ERROR", message: "Invalid spot reference"})
        })
    } catch (error){
        console.log(error)
        response.json({status: "ERROR", message: "Error updating comment"})
    }
    // response.json({'status': "good"})
})

app.post('/updateLiked', async (request, response) => {
    console.log(request.body)
    try{
        let spotID = ObjectId.createFromHexString(request.body.ID)
        await databaseMethods.getOne("spots", {_id: spotID})
        .then(async res => {
            console.log(res.interactions.likes)
            if(request.body.isLiked === "false") {
                await databaseMethods.makeUpdate("spots", {_id: spotID}, {
                    $push: {
                        "interactions.likes": request.session.user
                    }
                })
                .then(res => {
                    console.log(res)
                })
                .catch(error => {
                    console.log(error)
                })
            } else {
                let tempLikes = res.interactions.likes
                for (let x = 0; x < tempLikes.length; x++) {
                    if (tempLikes[x] === request.session.user) {
                        tempLikes.splice(x, 1)
                    }
                }
                console.log(tempLikes)
                await databaseMethods.makeUpdate("spots", {_id: spotID}, {
                    $set: {
                        "interactions.likes": tempLikes
                    }
                })
                .then(res => {
                    console.log(res)
                })
                .catch(error => {
                    console.log(error)
                })
            }
            response.json({status: "SUCCESS", message: "Post liked"})
        })
        .catch(error => {
            console.log(error)
            response.json({status: "ERROR", message: "Error adding like"})
        })
    } catch {
        response.json({status: "ERROR", message: "Error adding like"})
    }
})

app.get('/profilePicture', async (request, response) => {
    // console.log(request.query)
    let userID = ObjectId.createFromHexString(request.query.user)
    await databaseMethods.getOne("users", {_id: userID})
    .then(res => {
        console.log(res)
        if (res !== null) {
            response.json({status: "SUCCESS", message: "Loaded profile Imgages", picture: res.profileImage, user: res.username})
        }else {
            response.json({status: "ERROR", message: "User not found"})
        }
    })
    .catch(error => {
        console.log(error)
        response.json({status: "ERROR", message: "Error loading images"})
    })
})

app.get('/info', (request, response) => {
    response.render('info.ejs')
})

app.get('/profile', async (request, response) => {
    await databaseMethods.getOne("users", {username: request.session.user})
    .then(res => {
        console.log(res)
        userProfile = {
            username: res.username,
            email: res.email,
            preferences: {
                param1: res.preferences.param1,
                param2: res.preferences.param2,
                param3: res.preferences.param3
            },
            preferences2: {
                param1: res.preferences2.param1,
                param2: res.preferences2.param2,
                param3: res.preferences2.param3
            },
            profileImage: res.profileImage
        }
        response.render('profile.ejs', {user: userProfile})
    })
})

app.post('/updateProfile', async (request, response) => {
    try{
        let userID = request.session.userID
        let idObject = ObjectId.createFromHexString(userID)
        console.log("Profile updated")
        databaseMethods.makeUpdate("users", {_id: idObject}, {
            $set: {
                preferences: {
                    param1: request.body.param1 === "true" ? true : false,
                    param2: request.body.param2 === "true" ? true : false,
                    param3: request.body.param3 === "true" ? true : false
                },
                preferences2: {
                    param1: request.body.param4 === "true" ? true : false,
                    param2: request.body.param5 === "true" ? true : false,
                    param3: request.body.param6 === "true" ? true : false
                }
            }
        })
        .then(res => {
            console.log(res)
            response.json({status: "SUCCESS", message: "Profile updated"})
        })
        .catch(error => {
            console.log(error)
        })
    } catch (error) {
        console.log(error)
        // response.redirect("/profile")
        response.json({status: "ERROR", message: "Error making update"})
    }
})

app.post('/updateProfileImage', async (request, response) => {
    // console.log(request.headers)
    await databaseMethods.makeUpdate("users", {username: request.session.user}, {
        $set: {
            profileImage: request.body.profileImage
        }
    })
    .then(res => {
        console.log(res)
        response.json({status: "SUCCESS", message: "Profile image updated"})
    })
    .catch(error => {
        console.log(error)
        response.json({status: "ERROR", message: "Error updating profile Image"})
    })
})

app.get('/login', (request, response) => {
    response.render('login.ejs', {user: request.session.user})
})

app.post('/login', async (request, response) => {
    const password = request.body.password
    await databaseMethods.getOne("users", {email: request.body.email})
    .then(res => {
        console.log(cryptr.decrypt(res.password), password)
        console.log(res)
        if(password === cryptr.decrypt(res.password)) {
            request.session.user = res.username
            request.session.userID = res._id.toString()
            // response.redirect("/profile")
            response.json({status: "SUCCESS", message: "Login successful"})
        } else {
            response.json({status: "ERROR", message: "Password missmatch"})
        }
    })
    .catch(error => {
        console.log(error)
        response.json({status: "ERROR", message: "Could not get user"})
    })
})

app.get('/signup', (request, response) => {
    response.render('signup.ejs', {user: request.session.user})
})

app.post('/signup', async (request, response) => {
    const username = request.body.username
    const email = request.body.email
    const password = request.body.password
    const confirmpassword = request.body.confirmpassword
    if (password === confirmpassword) {
        await Promise.all([databaseMethods.getOne("users", {email: email}), databaseMethods.getOne("users", {username: username})])
        .then(async res => {
            console.log("Check users", res)
            if (res[0] === null && res[1] === null) {
                const encryptedpass = cryptr.encrypt(password)
                const user = {
                    username: username,
                    email: email,
                    password: encryptedpass,
                    verified: false,
                    preferences: {
                        param1: true,
                        param2: true,
                        param3: true
                    },
                    preferences2: {
                        param1: true,
                        param2: false,
                        param3: false
                    },
                    profileImage: "/images/defaultProfile2.png"
                }
                await databaseMethods.addOne("users", user)
                .then(async userResponse => {
                    console.log("User response", userResponse)
                    request.session.user = username
                    request.session.userID = userResponse.insertedId.toString()
                    request.session.email = email
                    // response.redirect("/profile")
                    let token = appFuncs.generateToken(7)
                    request.session.verifyToken = token
                    let currentTime = new Date()
                    request.session.tokenExpiry = currentTime.getTime() + 180000
                    let content = `<h1>Verify Account</h1> <p>Your Skate App verification token is ${token}</p>`
                    let mailresult = await appFuncs.sendPrimaryMail(email, "Skate App Account Verification", content)
                    console.log(mailresult)
                    console.log(mailresult.messageId)
                    response.json({status: "SUCCESS", message: "Created user", email: email})
                })
                .catch(error => {
                    console.log(error)
                    response.json({status: "ERROR", message: "There was an error creating account"})
                })
            } else if (res[0] !== null) {
                console.log("This email already exists")
                response.json({status: "ERROR", message: "This email already exists"})
            } else if (res[1] !== null) {
                console.log("This username already exists")
                response.json({status: "ERROR", message: "This username already exists"})
            }
        })
    } else {
        console.log("Password Missmatch")
        response.json({status: "ERROR", message: "Password Missmatch"})
    }
})

app.get("/verify", (request, response) => {
    if (request.session.email === undefined) {
        response.redirect("/login")
    } else {
        console.log("Token value", request.session.verifyToken)
        console.log(request.session.userID)
        let currentTime = new Date()
        // request.session.tokenExpiry = currentTime.getTime() + 10000
        console.log(request.session.tokenExpiry)
        let duration = request.session.tokenExpiry - currentTime.getTime()
        let expired = false
        if (duration < 0) {
            request.session.verifyToken = null
            expired = true
            duration = request.session.tokenExpiry - currentTime.getTime()
            console.log("Token Expired")
        }
        console.log(duration)
        response.render("verify.ejs", {user: request.session.user, duration: duration, expired: expired})
    }
})

app.post("/verify", async (request, response) => {
    if (request.session.email === undefined || request.session.email === null) {
        response.redirect("/login")
    }else {
        let token = request.session.verifyToken
        let sentToken = request.body.sentToken
        let currentTime = new Date()
        let duration = request.session.tokenExpiry - currentTime.getTime()
        let action = request.body.action
        if (action === "checkToken") {
            if(duration < 0) {
                response.json({status: "ERROR", message: "Token Expired, try again"})
            } else if (token === sentToken && duration > 0) {
                console.log("Token matched")
                let ID = ObjectId.createFromHexString(request.session.userID)
                await databaseMethods.makeUpdate("users", {_id: ID}, {
                    $set: {
                        verified: true
                    }
                })
                .then(verifiedRes => {
                    console.log(verifiedRes)
                    request.session.verifyToken = null
                    request.session.tokenExpiry = null
                    response.json({status: "SUCCESS", message: "Token Match"})
                })
                .catch(error => {
                    console.log(error)
                    response.json({status: "ERROR", message: "Error updating user"})
                })

            } else {
                console.log("Token mismatch")
                response.json({status: "ERROR", message: "Token Missmatch"})
            }
        } else if (action === "resendToken") {
            let token = appFuncs.generateToken(7)
            request.session.verifyToken = token
            let currentTime = new Date()
            request.session.tokenExpiry = currentTime.getTime() + 180000
            duration = request.session.tokenExpiry - currentTime.getTime()
            let content = `<h1>Verify Account</h1> <p>Your Skate App verification token is ${token}</p>`
            let mailresult = await appFuncs.sendPrimaryMail("darrylandrew22@gmail.com", "Skate App Account Verification", content)
            console.log(mailresult)
            console.log(mailresult.messageId)
            response.json({status: "SUCCESS", duration: duration})
        }
    }
})

app.get("/logout", (request, response) => {
    request.session.user = "anonymous"
    response.redirect("/login")
})

app.listen(port, () => {
    console.log(`Started at http://localhost:${port}`)
})