const express = require("express")
const app = express()
const port = 3000
require("dotenv").config()
const bodyParser = require("body-parser")
const fs = require("fs")

const Cryptr = require("cryptr")
const cryptr = new Cryptr(process.env.ENCRYPTION_KEY)
const bcrypt = require("bcrypt")
const saltRounds = 10
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
let databaseMethods = new DatabaseMethods()
let appFuncs = new appFunctions()
const ExpressSanitizer = require("perfect-express-sanitizer")

app.set('view engine', 'ejs')
app.use(express.static('public'))
app.use(express.json({limit: "300mb"}))
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
    console.log(request.method, request.path)
    if (request.session.username === undefined) {
        request.session.username = "anonymous"
    }
    if (request.session.darkMode === undefined) {
        request.session.darkMode = "none"
    }
    next()
})

app.get('/', async (request, response) => {
    response.render('index.ejs', {user: request.session.username, darkMode: request.session.darkMode})
})

app.get('/getUser', async (request, response) => {
    if (request.session.username === undefined) {
        response.json({status: "Error getting user", user: "anonymous"})
    }else {
        // await databaseMethods.getOne("users", {username: request.session.username})
        // .then(res => {
        //     console.log(res)
        // })
        // .catch(error => {
        //     console.log(error)
        // })
        response.json({user: request.session.username})
    }
})

app.get('/map', async (request, response) => {
    let date = new Date()
    // let currentDate = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
    await Promise.all([databaseMethods.getMany("spots"), databaseMethods.getOne("users", {username: request.session.username})])
    .then(res => {
        // console.log(res[1])
        let darkMap = "true"
        if (res[1] !== null) {
            darkMap = res[1].settings.darkMap
        }
        
        response.render('map.ejs', {mapboxtoken : process.env.MAPBOX_ACCESS_TOKEN, spots: res[0], user: request.session.username, userID: request.session.userID, darkMode: request.session.darkMode, darkMap: darkMap})
    })
    .catch(error => {
        console.log(error)
        response.redirect("/")
    })
})

app.post('/addspot', async (request, response) => {
    const date = new Date()
    let currentDate = date.toISOString().split("T")
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
        createdBy: request.session.username,
        createdByID: request.session.userID,
        interactions: {
            likes: [],
            comments: []
        },
        dateCreated: currentDate[0]
    }

    await databaseMethods.addOne("spots", data)
    .then(res => {
        return databaseMethods.getOne("spots", {_id: res.insertedId})
    })
    .then(spot => {
        response.json({status: "SUCCESS", message: "New spot added", newSpot: spot._id})
    })
    .catch(error => {
        console.log(error)
        response.json({status: "ERROR", message: "Error getting created item, please reload page"})
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
    try {
        let date = new Date()
        let currentDate = date.toISOString().split("T")
        let updateData = {
            content: request.body.comment,
            type: request.body.type,
            spotId: request.body.spotId,
            replyId: request.body.replyId,
            author: request.session.userID,
            dateAdded: currentDate[0]
        }
        await databaseMethods.addOne("comment", updateData)
        .then(res => {
            return databaseMethods.getOne("comment", {_id: res.insertedId})
        })
        .then(res => {
            response.json({status: "SUCCESS", message: "Updated comments", newComment: res})
        })
        .catch(error => {
            console.log(error)
            response.json({status: "ERROR", message: "Error updating comment"})
        })
    } catch (error){
        console.log(error)
        response.json({status: "ERROR", message: "Error updating comment"})
    }
    // response.json({'status': "good"})
})

app.get("/loadComments", async (request, response) => {
    try{
        let id = request.query.spotId
        await Promise.allSettled([databaseMethods.getMany("comment", {spotId: id, type: "comment"}), databaseMethods.getMany("comment", {spotId: id, type: "reply"})])
        .then(res => {
            let commentsList = [...res[0].value]
            let repliesList = [...res[1].value]
            response.json({status: "SUCCESS", message: "Loaded comments", comments: commentsList, replies: repliesList})
        })
        .catch(error => {
            console.log(error)
            response.json({status: "ERROR", message: "Error loading comments"})
        })
    } catch (error) {
        console.log(error)
    }
})

app.post("/commentUserInfo", async (request, response) => {
    try {
        let usersList = request.body.usersList
        let usersPromises = []
        for (let x = 0; x < usersList.length; x++) {
            let id = ObjectId.createFromHexString(usersList[x])
            usersPromises.push(databaseMethods.getOne("users", {_id: id}))
        }
        await Promise.allSettled(usersPromises)
        .then(res => {
            let commentsData = []
            for (let x = 0; x < res.length; x++) {
                if (res[x].status === 'fulfilled' && res[x].value !== null) {
                    commentsData.push({
                        id: res[x].value._id,
                        username: res[x].value.username,
                        profilePicture: res[x].value.profileImage,
                    })
                }
            }
            response.json({status: "SUCCESS", message: "Loaded comments info", data: commentsData})
        })
        .catch(error => {
            console.log(error)
            response.json({status: "ERROR", message: "Error Loading comments info"})
        })
    } catch (error) {
        console.log(error)
    }
})

app.post('/updateLiked', async (request, response) => {
    try{
        let spotID = ObjectId.createFromHexString(request.body.ID)
        let likesCount = 0
        await databaseMethods.getOne("spots", {_id: spotID})
        .then(async res => {
            console.log(res.interactions.likes)
            if(request.body.isLiked === "false") {
                let spotLikeUpdate = databaseMethods.makeUpdate("spots", {_id: spotID}, {
                    $push: {
                        "interactions.likes": request.session.userID
                    }
                })
                return spotLikeUpdate
            } else {
                let tempLikes = res.interactions.likes
                for (let x = 0; x < tempLikes.length; x++) if (tempLikes[x] === request.session.userID) tempLikes.splice(x, 1)
                let userID = ObjectId.createFromHexString(request.session.userID)
                // let spotLikeUpdate = databaseMethods.makeUpdate("spots", {_id: spotID}, {
                //     $set: {
                //         "interactions.likes": tempLikes
                //     }
                // })
                let spotLikeUpdate = await Promise.all([databaseMethods.makeUpdate("spots", {_id: spotID}, {
                    $set: {
                        "interactions.likes": tempLikes
                    }
                }), databaseMethods.getOne("users", {_id: userID})])
                return spotLikeUpdate
            }
        })
        .then(res => {
            console.log("spot likes Update", res)
            let userID = ObjectId.createFromHexString(request.session.userID)
            if (request.body.isLiked === "false") {
                return databaseMethods.makeUpdate("users", {_id: userID}, {
                    $push: {
                        likedSpots: request.body.ID
                    }
                })
            } else {
                let tempLikedSpots = res[1].likedSpots
                for (let x = 0; x < tempLikedSpots.length; x++) if (tempLikedSpots[x] === request.body.ID) tempLikedSpots.splice(x, 1)
                return databaseMethods.makeUpdate("users", {_id: userID}, {
                    $set: {
                        likedSpots: tempLikedSpots
                    }
                })
            }
        })
        .then(res => {
            console.log("Spot user Like update", res)
            response.json({status: "SUCCESS", message: "Like action complete"})
        })
        .catch(error => {
            console.log(error)
            response.json({status: "ERROR", message: "Error with like action"})
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
        // console.log(res)
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
    if (request.session.username === undefined || request.session.username === "anonymous") {
        return response.redirect("/")
    }
    await databaseMethods.getOne("users", {username: request.session.username})
    .then(res => {
        userProfile = {
            username: res.username,
            email: res.email,
            verified: res.verified,
            settings: {
                twoFactorAuth: res.settings.twoFactorAuth,
                darkMode: res.settings.darkMode,
                darkMap: res.settings.darkMap
            },
            profileImage: res.profileImage,
            likedSpots: res.likedSpots
        }
        response.render('profile.ejs', {user: userProfile, darkMode: request.session.darkMode})
    })
})

app.post('/updateProfile', async (request, response) => {
    try{
        let userID = request.session.userID
        let idObject = ObjectId.createFromHexString(userID)
        console.log("Profile updated")
        await databaseMethods.makeUpdate("users", {_id: idObject}, {
            $set: {
                settings: {
                    twoFactorAuth: request.body.twoFactorAuth === "true" ? true : false,
                    darkMode: request.body.darkMode === "true" ? true : false,
                    darkMap: request.body.darkMap === "true" ? true : false,
                },
            }
        })
        .then(res => {
            console.log(res)
            request.session.darkMode = request.body.darkMode
            response.json({status: "SUCCESS", message: "Profile updated"})
        })
        .catch(error => {
            console.log(error)
            response.json({status: "ERROR", message: "Error with update"})
        })
    } catch (error) {
        console.log(error)
        // response.redirect("/profile")
        response.json({status: "ERROR", message: "Error making update"})
    }
})

app.post("/updateProfileInfo", async (request, response) => {
    console.log(request.body)
    let ID = ObjectId.createFromHexString(request.session.userID)
    let updateData = {}
    updateData[`${request.body.paramName}`] = request.body.inputValue
    await databaseMethods.makeUpdate("users", {_id: ID}, {
        $set: updateData
    })
    .then(res => {
        if (request.body.paramName === "username") {
            console.log("renaming spots")
            return databaseMethods.makeMultipleUpdates("spots", {createdByID: request.session.userID}, {
                $set: {
                    createdBy: request.body.inputValue
                }
            })
        }
    })
    .then(res => {
        console.log(res)
        request.session[`${request.body.paramName}`] = request.body.inputValue
        response.json({status: "SUCCESS", message: "Profile Updated", updatedValue: request.body.inputValue})
    })
    .catch(error => {
        response.json({status: "ERROR", message: "Error updating profile"})
    })
})

app.get('/getMyUploads', async (request, response) => {
    await databaseMethods.getMany("spots", {createdBy: request.session.username})
    .then(res => {
        response.json({status: "SUCCESS", message: "spots retrieved", myUploads: res})
    })
    .catch(error => {
        console.log(error)
        response.json({status: "ERROR", message: "Could not retrieve uploads"})
    })
})

app.get('/getLikedSpots', async (request, response) => {
    let userID = ObjectId.createFromHexString(request.session.userID)
    await databaseMethods.getOne("users", {_id: userID})
    .then(res => {
        let myLikes = []
        for (let x = 0; x < res.likedSpots.length; x++) {
            try {
                let likedId = ObjectId.createFromHexString(res.likedSpots[x])
                myLikes.push(databaseMethods.getOne("spots", {_id: likedId}))
            } catch(error) {
                console.log("Cannot get value")
            }
        }
        return Promise.allSettled(myLikes)
    })
    .then(res => {
        console.log(res)
        response.json({status: "SUCCESS", message: "spots retrieved", myLikes: res})
    })
    .catch(error => {
        console.log(error)
        response.json({status: "ERROR", message: "Could not retrieve uploads"})
    })
})

app.post("/deleteImages", async (request, response) => {
    console.log(request.body.imageList)
    let ID = ObjectId.createFromHexString(request.body.id)
    await databaseMethods.getOne("spots", {_id: ID})
    .then(res => {
        let tempImages = []
        for (let x = 0; x < res.spotimages.length; x++) {
            if (request.body.imageList[x].isSelected === false) {
                tempImages.push(res.spotimages[x])
            }
        }
        console.log(tempImages.length)
        return databaseMethods.makeUpdate("spots", {_id: ID}, {
            $set: {
                spotimages: tempImages
            }
        })
    })
    .then(res => {
        return databaseMethods.getOne("spots", {_id: ID})
    })
    .then(res => {
        response.json({status: "SUCCESS", message: "Images Deleted", newImages: res.spotimages})
    })
    .catch(error => {
        console.log(error)
        response.json({status: "ERROR", message: "Error deleting images"})
    })
})

app.post('/addSpotImages', async (request, response) => {
    console.log(request.body.imagesData.length)
    let ID = ObjectId.createFromHexString(request.body.spotID)
    await databaseMethods.makeUpdate("spots", {_id: ID}, {
        $push: {
            spotimages: {$each : request.body.imagesData}
        }
    })
    .then(res => {
        return databaseMethods.getOne("spots", {_id: ID})
    })
    .then(res => {
        response.json({status: "SUCCESS", message: "New images added", newImages: res.spotimages})
    })
    .catch(error => {
        console.log(error)
    })
})

app.post("/deleteSpot", async (request, response) => {
    console.log(request.body)
    let id = ObjectId.createFromHexString(request.body.spotID)
    await databaseMethods.deleteDocument("spots", {_id: id})
    .then(res => {
        console.log(res)
        response.json({status: "SUCCESS", message: "Spot Deleted"})
    })
    .catch(error => {
        console.log(error)
        response.json({status: "ERROR", message: "Error deleting spot"})
    })
})

app.post('/updateProfileImage', async (request, response) => {
    // console.log(request.headers)
    await databaseMethods.makeUpdate("users", {username: request.session.username}, {
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
    response.render('login.ejs', {user: request.session.username, darkMode: request.session.darkMode})
})

app.post('/login', async (request, response) => {
    const password = request.body.password
    await databaseMethods.getOne("users", {email: request.body.email})
    .then(async res => {
        if (res === null) return response.json({status: "ERROR", message: "User not found"})
        let checkPass = await bcrypt.compare(password, res.password)
        console.log(checkPass)
        if(checkPass) {
            request.session.username = res.username
            request.session.userID = res._id.toString()
            request.session.email = res.email
            request.session.darkMode = res.darkMode ? "true" : "false"
            response.json({status: "SUCCESS", message: "Login successful"})
        } else {
            response.json({status: "ERROR", message: "Password missmatch"})
        }
    })
    .catch(error => {
        console.log(error)
        response.json({status: "ERROR", message: "Error with login"})
    })
})

app.get('/signup', (request, response) => {
    response.render('signup.ejs', {user: request.session.username, darkMode: request.session.darkMode})
})

app.post('/signup', async (request, response) => {
    if (request.body.password !== request.body.confirmpassword) return response.json({status: "ERROR", message: "Password Missmatch"})
    const date = new Date()
    await Promise.all([databaseMethods.getOne("users", {email: request.body.email}), databaseMethods.getOne("users", {username: request.body.username})])
    .then(async res => {
        console.log("Check users", res)
        if (res[0] !== null) return response.json({status: "ERROR", message: "This email already exists"})
        if (res[1] !== null) return response.json({status: "ERROR", message: "This username already exists"})

        let currentDate = date.toISOString().split("T")
        const hashedPass = await bcrypt.hash(request.body.password, saltRounds)
        const user = {
            username: request.body.username,
            email: request.body.email,
            password: hashedPass,
            verified: false,
            settings: {
                twoFactorAuth: false,
                darkMode: false,
                darkMap: false
            },
            profileImage: "/images/defaultProfile2.png",
            likedSpots: [],
            dateCreated: currentDate[0]
        }
        return user
    })
    .then(async res => {
        return databaseMethods.addOne("users", res)
    })
    .then(async res => {
        console.log("User response", res)
        request.session.username = request.body.username
        request.session.userID = res.insertedId.toString()
        request.session.email = request.body.email
        request.session.darkMode = "false"
        // response.redirect("/profile")
        let token = appFuncs.generateToken(7)
        request.session.verifyToken = token
        let currentTime = new Date()
        request.session.tokenExpiry = currentTime.getTime() + 180000
        let content = `<h1>Verify Account</h1> <p>Your Skate App verification token is ${token}</p>`
        let mailresult = await appFuncs.sendPrimaryMail(request.body.email, "Skate App Account Verification", content)
        console.log(mailresult.messageId)
        console.log(mailresult)
        response.json({status: "SUCCESS", message: "Created user", email: request.body.email})
    })
    .catch(error => {
        console.log(error)
        response.json({status: "ERROR", message: "Error getting user"})
    })
})

app.get("/verify", async (request, response) => {
    if (request.session.email === undefined) {
        return response.redirect("/login")
    }
    let duration = 0
    if (!request.session.verifyToken) {
        let token = appFuncs.generateToken(7)
        request.session.verifyToken = token
        let currentTime = new Date()
        request.session.tokenExpiry = currentTime.getTime() + 180000
        duration = request.session.tokenExpiry - currentTime.getTime()
        let content = `<h1>Verify Account</h1> <p>Your Skate App verification token is ${token}</p>`
        let mailresult = await appFuncs.sendPrimaryMail("darrylandrew22@gmail.com", "Skate App Account Verification", content)
    }
    
    console.log("Token value", request.session.verifyToken)
    console.log(request.session.userID)
    let currentTime = new Date()
    // request.session.tokenExpiry = currentTime.getTime() + 10000
    console.log(request.session.tokenExpiry)
    duration = request.session.tokenExpiry - currentTime.getTime()
    let expired = false
    if (duration < 0) {
        request.session.verifyToken = null
        expired = true
        duration = request.session.tokenExpiry - currentTime.getTime()
        console.log("Token Expired")
    }
    console.log(duration)
    response.render("verify.ejs", {user: request.session.username, duration: duration, expired: expired, darkMode: request.session.darkMode})
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
            response.json({status: "SUCCESS", duration: duration})
        }
    }
})

app.get("/logout", (request, response) => {
    // request.session.username = "anonymous"
    request.session.destroy()
    response.redirect("/login")
})

app.listen(port, () => {
    console.log(`Started at http://localhost:${port}`)
})