const express = require("express")
const app = express()
require("dotenv").config()
const bodyParser = require("body-parser")

const Cryptr = require("cryptr")
const cryptr = new Cryptr(process.env.ENCRYPTION_KEY)
const crypto = require("node:crypto")
const bcrypt = require("bcrypt")
const saltRounds = 10
const session = require("express-session")
const {ObjectId} = require("mongodb")
const MongoDBStore  = require("connect-mongodb-session")(session)
const store = new MongoDBStore ({
    uri: "mongodb://localhost:27017/skateapp",
    databaseName: "skateapp",
    collection: "mySessions"
})

const DatabaseMethods = require("./dbFunctions")
const appFunctions = require("./appFunctions")
let databaseMethods = new DatabaseMethods()
let appFuncs = new appFunctions()
const ExpressSanitizer = require("perfect-express-sanitizer")
const {rateLimit} = require("express-rate-limit")
const limiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
    ipv6Subnet: 56
})


const helmet = require("helmet")

app.use((request, response, next) => {
    response.locals.cspNonce = crypto.randomBytes(32).toString("hex")
    next()
})
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            "script-src": ["'self'", "cdn.jsdelivr.net", "api.mapbox.com", (request, response) => `'nonce-${response.locals.cspNonce}'`],
            "connect-src": ["'self'", "cdn.jsdelivr.net", "api.mapbox.com", "events.mapbox.com"],
            "worker-src": ["'self'", "blob:", "cdn.jsdelivr.net"]
        }
    }
}))

app.set('view engine', 'ejs')
app.use(express.static('public'))
app.use(express.json({limit: "300mb"}))
app.use(bodyParser.urlencoded({extended: true, limit: "25mb"}))
app.use(require("express-session")({
    secret: process.env.SESSION_SECRET,
    cookie: {
        maxAge: 86400000,
        secure: process.env.ENVIRONMENT === "prod",
        httpOnly: true
    },
    store: store,
    proxy: true,
    resave: true,
    saveUninitialized: false
}))

app.use((request, response, next) => {
    response.locals.user = "none"
    response.locals.darkMode = "none"
    response.locals.isLoggedIn = false
    if (request.session.username) {
        response.locals.user = request.session.username
        response.locals.isLoggedIn = true
        response.locals.darkMode = request.session.darkMode
    }
    next()
})

app.get('/', async (request, response) => {
    response.render('index.ejs')
})

app.get('/getUser', async (request, response) => {
    try{
        if (request.session.username === undefined) return response.json({status: "ERROR", message: "Anonymous user"})
        await databaseMethods.getOne("users", {username: request.session.username})
        .then(res => {
            let user = {username: res.username, profileImage: res.profileImage}
            response.json({status: "SUCCESS", message: "User Retrieved", user: user})
        })
        .catch(error => {
            response.json({status: "ERROR", message: "Could not get user"})
        })
    } catch (error) {
        response.json({status: "ERROR", message: "Could not get user"})
    }
})

// spots endpoints

app.get('/map', async (request, response) => {
    let mapPromises = [databaseMethods.getMany("spots"), databaseMethods.getOne("users", {username: request.session.username})]
    if (response.locals.isLoggedIn) {
        mapPromises.push(databaseMethods.getMany("likes", {type: "spot", likeUser: ObjectId.createFromHexString(request.session.userID)}))
    }
    await Promise.all(mapPromises)
    .then(res => {
        let darkMap = "true"
        let profilePicture = '/images/defaultProfile2.png'
        let likes = []
        if (res[1] !== null) {
            darkMap = res[1].settings.darkMap
            profilePicture = res[1].profileImage
        }
        if (response.locals.isLoggedIn) {
            likes = res[2]
        }
        let ctx = {
            mapboxtoken : process.env.MAPBOX_ACCESS_TOKEN,
            spots: res[0],
            userID: request.session.userID,
            isLoggedIn: response.locals.isLoggedIn,
            profilePicture: profilePicture,
            darkMap: darkMap,
            likes: likes
        }
        response.render('map.ejs', ctx)
    })
    .catch(error => {
        response.redirect("/")
    })
})

app.post('/addspot', async (request, response) => {
    if (!response.locals.isLoggedIn) {return response.json({status: "ERROR", message: "Login required to upload spot"})}
    const date = new Date()
    let currentDate = date.toISOString().split("T")
    const options = { xss: true, noSql: true, sql: true, level: 5 }
    if (request.body.description.length > 200) {
        return response.json({status: "ERROR", message: "Too many characters, maximum of 200 allowed."})
    }
    let userId = ObjectId.createFromHexString(request.session.userID)
    let sanitizedDesc = ExpressSanitizer.sanitize.prepareSanitize(request.body.description, options)
    let data = {
        description: sanitizedDesc,
        spottype: request.body.spottype,
        longitude: request.body.lng,
        latitude: request.body.lat,
        createdBy: request.session.username,
        createdByID: userId,
        dateCreated: currentDate[0],
        dateCreatedInMs: date.getTime(),
        likesCount: 0,
        commentsCount: 0
    }
    let insertId = null
    let uploads = [...request.body.spotimages]
    await databaseMethods.addOne("spots", data)
    .then(res => {
        insertId = res.insertedId
        for (let x = 0; x < request.body.spotimages.length; x++) {
            uploads[x]["spotId"] = res.insertedId
            uploads[x]["user"] = userId
        }
        return databaseMethods.addMultiple("spotimages", uploads)
    })
    .then(res => {
        return databaseMethods.getOne("spots", {_id: insertId})
    })
    .then(res => {
        response.json({status: "SUCCESS", message: "New spot added", newSpot: res._id})
    })
    .catch(error => {
        response.json({status: "ERROR", message: "Error getting created item, please reload page"})
    })

    // response.redirect("/map")
})

app.get('/getSpot', async (request, response) => {
    try{
        let spotId = ObjectId.createFromHexString(request.query.spotId)
        let spot = null
        await databaseMethods.getOne("spots", {_id: spotId})
        .then(res => {
            if(res === null) {return response.json({status: "ERROR", message: "Spot not found"})}
            spot = res
            return databaseMethods.getManySorted("spotimages", {spotId: spotId}, {position: 1})
        })
        .then(res => {
            response.json({status: "SUCCESS", message: "Reference received", spot: spot, images: res})
        })
        .catch(error => {
            response.json({status: "ERROR", message: "There was an error getting spot"})
        })
    } catch(error) {
        response.json({status: "ERROR", message: "Invalid reference"})
    }
})

app.post("/getSpotImages", async (request, response) => {
    let spotId = ObjectId.createFromHexString(request.body.spotId)
    let query = {spotId: spotId}
    let sort = {}
    if (request.body.action === "first") {query["position"] = 0}
    if (request.body.action === "all") {sort["position"] = 1}
    await databaseMethods.getManySorted("spotimages", query, sort)
    .then(res => {
        response.json({status: "SUCCESS", message: "Loaded Spot Images", images: res})
    })
    .catch(error => {
        response.json({status: "ERROR", message: "Error loading spot images"})
    })
})

app.post('/updateComment', async (request, response) => {
    try {
        if (request.session.username === undefined) return response.json({status: "ERROR", message: "Login required for interactions"})
        const date = new Date()
        let spotId = ObjectId.createFromHexString(request.body.spotId)
        let replyId = request.body.replyId
        if (replyId !== "") {
            replyId = ObjectId.createFromHexString(request.body.replyId)
        }
        let currentDate = date.toISOString().split("T")
        let updateData = {
            content: request.body.comment,
            type: request.body.type,
            spotId: spotId,
            replyId: replyId,
            author: request.session.userID,
            dateAdded: currentDate[0],
            dateAddedInMs: date.getTime()
        }
        await Promise.all([databaseMethods.addOne("comment", updateData), databaseMethods.makeUpdate("spots", {_id: spotId}, {$inc: {commentsCount: 1}})])
        .then(res => {
            return databaseMethods.getOne("comment", {_id: res[0].insertedId})
        })
        .then(res => {
            response.json({status: "SUCCESS", message: "Updated comments", newComment: res})
        })
        .catch(error => {
            response.json({status: "ERROR", message: "Error updating comment"})
        })
    } catch (error){
        response.json({status: "ERROR", message: "Error updating comment"})
    }
    // response.json({'status': "good"})
})

app.get("/loadComments", async (request, response) => {
    try{
        let id = ObjectId.createFromHexString(request.query.spotId)
        await Promise.allSettled([databaseMethods.getMany("comment", {spotId: id, type: "comment"}), databaseMethods.getMany("comment", {spotId: id, type: "reply"})])
        .then(res => {
            let commentsList = [...res[0].value]
            let repliesList = [...res[1].value]
            let commentsCount = commentsList.length + repliesList.length
            response.json({status: "SUCCESS", message: "Loaded comments", comments: commentsList, replies: repliesList, commentsCount: commentsCount})
        })
        .catch(error => {
            response.json({status: "ERROR", message: "Error loading comments"})
        })
    } catch (error) {
        response.json({status: "ERROR", message: "Error loading comments"})
    }
})

app.post("/commentUserInfo", async (request, response) => {
    try {
        let usersList = request.body.usersList
        let usersIdList = []
        for (let x = 0; x < usersList.length; x++) {
            let id = ObjectId.createFromHexString(usersList[x])
            usersIdList.push(id)
        }
        await databaseMethods.getMany("users", {_id: {$in: usersIdList}})
        .then(res => {
            let commentsData = []
            for (let x = 0; x < res.length; x++) {
                commentsData.push({
                    id: res[x]._id,
                    username: res[x].username,
                    profilePicture: res[x].profileImage,
                })
            }
            response.json({status: "SUCCESS", message: "Loaded comments info", data: commentsData})
        })
        .catch(error => {
            response.json({status: "ERROR", message: "Error Loading comments info"})
        })
    } catch (error) {
        response.json({status: "ERROR", message: "Error Loading comments info"})
    }
})

app.post("/deleteComment", async (request, response) => {
    try {
        let commentID = ObjectId.createFromHexString(request.body.commentID)
        let spotId = ObjectId.createFromHexString(request.body.spotId)
        let deleteLength = parseInt(request.body.deleteLength)
        let deletePromiseList = [databaseMethods.deleteDocument("comment", {_id: commentID}), databaseMethods.makeUpdate("spots", {_id: spotId}, {$inc: {commentsCount: -deleteLength}})]
        if (request.body.type === "comment" && request.body.deleteLength > 1) {
            deletePromiseList.push(databaseMethods.deleteManyDocuments("comment", {replyId: commentID}))
        }
        await Promise.all(deletePromiseList)
        .then(res => {
            response.json({status: "SUCCESS", message: "Comment Deleted"})
        })
        .catch(error => {
            response.json({status: "ERROR", message: "Error deleting comment"})
        })
    } catch(error) {
        response.json({status: "ERROR", message: "Error deleting comment"})
    }
})

app.post('/updateLiked', async (request, response) => {
    try{
        if (!request.session.isLoggedIn) {
            return response.json({status: "ERROR", message: "Login required for interactions"})
        }
        let likePromise = []
        let spotId = ObjectId.createFromHexString(request.body.ID)
        let likeObject = {
            spotId: spotId,
            likeUser: ObjectId.createFromHexString(request.session.userID),
            type: "spot"
        }
        if (request.body.isLiked === "false") {
            likePromise.push(databaseMethods.addOne("likes", likeObject))
            likePromise.push(databaseMethods.makeUpdate("spots", {_id: spotId}, {$inc: {likesCount: 1}}))
        } else {
            let likeRef = ObjectId.createFromHexString(request.body.likeRef)
            likePromise.push(databaseMethods.deleteDocument("likes", {_id: likeRef}))
            likePromise.push(databaseMethods.makeUpdate("spots", {_id: spotId}, {$inc: {likesCount: -1}}))
        }
        await Promise.allSettled(likePromise)
        .then(res => {
            if (request.body.isLiked === "false") {
                return response.json({status: "SUCCESS", message: "Like Updated", isLiked: true, likeRef: res[0].value.insertedId.toString()})
            }
            response.json({status: "SUCCESS", message: "Like Updated", isLiked: false, likeRef: "none"})
        })
    } catch (error) {
        response.json({status: "ERROR", message: "Error adding like"})
    }
})

app.get('/profilePicture', async (request, response) => {
    let userID = ObjectId.createFromHexString(request.query.user)
    await databaseMethods.getOne("users", {_id: userID})
    .then(res => {
        if (res !== null) {
            response.json({status: "SUCCESS", message: "Loaded profile Imgages", picture: res.profileImage, user: res.username})
        }else {
            response.json({status: "ERROR", message: "User not found"})
        }
    })
    .catch(error => {
        response.json({status: "ERROR", message: "Error loading images"})
    })
})

app.get('/info', (request, response) => {
    response.render('info.ejs')
})

// profile endpoints

app.get('/profile', async (request, response) => {
    if (request.session.username === undefined || request.session.username === "none") {
        return response.redirect("/")
    }
    await databaseMethods.getOne("users", {username: request.session.username})
    .then(res => {
        userProfile = {
            username: res.username,
            email: res.email,
            verified: res.verified,
            settings: res.settings,
            profileImage: res.profileImage
        }
        response.render('profile.ejs', {userProfile: userProfile})
    })
})

app.post('/updateProfile', async (request, response) => {
    try{
        let userID = request.session.userID
        let idObject = ObjectId.createFromHexString(userID)
        let settingsUpdate = {}
        settingsUpdate[`settings.${request.body.param}`] = request.body.value === "true" ? true : false
        await databaseMethods.makeUpdate("users", {_id: idObject}, {$set: settingsUpdate})
        .then(res => {
            if (request.body.param === "darkMode") {
                request.session.darkMode = request.body.value
            }
            response.json({status: "SUCCESS", message: "Profile updated"})
        })
        .catch(error => {
            response.json({status: "ERROR", message: "Error with update"})
        })
    } catch (error) {
        // response.redirect("/profile")
        response.json({status: "ERROR", message: "Error making update"})
    }
})

app.post("/updateProfileInfo", async (request, response) => {
    let ID = ObjectId.createFromHexString(request.session.userID)
    let updateData = {}
    updateData[`${request.body.paramName}`] = request.body.inputValue
    console.log(updateData)
    // await databaseMethods.getOne("users", {$or: [{email: request.body.inputValue}, {username: request.body.inputValue}]})
    await databaseMethods.getOne("users", updateData)
    .then(res => {
        console.log(res)
        if (res !== null) {return `${request.body.paramName} exists`}
        return databaseMethods.makeUpdate("users", {_id: ID}, {
            $set: updateData
        })
    })
    .then(res => {
        console.log(res)
        if (res === `${request.body.paramName} exists`) {return `${request.body.paramName} exists`}
        if (request.body.paramName === "username") {
            return databaseMethods.makeMultipleUpdates("spots", {createdByID: ID}, {
                $set: {
                    createdBy: request.body.inputValue
                }
            })
        }
        if (request.body.paramName === "email") {
            return databaseMethods.makeUpdate("users", {_id: ID}, {
                $set: {
                    verified: false
                }
            })
        }
    })
    .then(res => {
        console.log("spots update", res)
        if (res === `${request.body.paramName} exists`) {return response.json({status: "ERROR", message: `An account with ${request.body.paramName} already exists`})}
        request.session[`${request.body.paramName}`] = request.body.inputValue
        response.json({status: "SUCCESS", message: "Profile Updated", updatedValue: request.body.inputValue})
    })
    .catch(error => {
        console.log(error)
        response.json({status: "ERROR", message: "Error updating profile"})
    })
})

app.get('/getMyUploads', async (request, response) => {
    await databaseMethods.getMany("spots", {createdBy: request.session.username})
    .then(res => {
        response.json({status: "SUCCESS", message: "spots retrieved", myUploads: res})
    })
    .catch(error => {
        response.json({status: "ERROR", message: "Could not retrieve uploads"})
    })
})

app.get('/getLikedSpots', async (request, response) => {
    let Id = ObjectId.createFromHexString(request.session.userID)
    await databaseMethods.getMany("likes", {likeUser: Id, type: "spot"})
    .then(res => {
        let spotIdList = []
        for (let x = 0; x < res.length; x++) {
            spotIdList.push(res[x].spotId)
        }
        // return Promise.all([databaseMethods.getMany("spots", {_id: {$in: spotIdList}})])
        return databaseMethods.getMany("spots", {_id: {$in: spotIdList}})
    })
    .then(res => {
        response.json({status: "SUCCESS", message: "spots retrieved", myLikes: res})
    })
    .catch(error => {
        response.json({status: "ERROR", message: "Could not retrieve likes"})
    })
})

app.post("/modifyImages", async (request, response) => {
    let imageList = request.body.imageList
    let imagePromises = []
    let spotId = ObjectId.createFromHexString(imageList[0].spotId)
    let newPosition = 0
    for (let x = 0; x < imageList.length; x++) {
        if (imageList[x].isSelected) {
            let imageId = ObjectId.createFromHexString(imageList[x].imageId)
            imagePromises.push(databaseMethods.deleteDocument("spotimages", {_id: imageId}))
        } else {
            let imageId = ObjectId.createFromHexString(imageList[x].imageId)
            imagePromises.push(databaseMethods.makeUpdate("spotimages", {_id: imageId}, {
                $set: {
                    position: newPosition
                }
            }))
            newPosition = newPosition + 1
        }
    }
    await Promise.all(imagePromises)
    .then(res => {
        return databaseMethods.getManySorted("spotimages", {spotId: spotId}, {position: 1})
    })
    .then(res => {
        response.json({status: "SUCCESS", message: "Images Modified", newImages: res})
    })
    .catch(error => {
        response.json({status: "ERROR", message: "Error deleting images"})
    })
})

app.post('/addSpotImages', async (request, response) => {
    let images = request.body.imagesData
    let Id = ObjectId.createFromHexString(request.session.userID)
    let sendData = []
    let spotId = ObjectId.createFromHexString(images[0].spotId)
    for (let x = 0; x < images.length; x++) {
        sendData.push({
            ...images[x],
            spotId: spotId,
            user: Id
        })
    }
    await databaseMethods.addMultiple("spotimages", sendData)
    .then(res => {
        let newImageIds = []
        for (let x = 0; x < images.length; x++) {
            newImageIds.push(res.insertedIds[x])
        }
        return databaseMethods.getMany("spotimages", {_id: {$in: newImageIds}})
    })
    .then(res => {
        response.json({status: "SUCCESS", message: "New images added", newImages: res})
    })
    .catch(error => {
        response.json({status: "ERROR", message: "Error adding new images"})
    })
})

app.post("/updateSpotDetails", async (request, response) => {
    let spotId = ObjectId.createFromHexString(request.body.spotId)
    let spotUpdate = {}
    spotUpdate[`${request.body.param}`] = request.body.value
    await databaseMethods.makeUpdate("spots", {_id: spotId}, {
        $set: spotUpdate
    })
    .then(res => {
        response.json({status: "SUCCESS", message: "Spot updated"})
    })
    .catch(error => {
        response.json({status: "ERROR", message: "Error updating spot"})
    })
})

app.post("/deleteSpot", async (request, response) => {
    let id = ObjectId.createFromHexString(request.body.spotId)
    await Promise.all([databaseMethods.deleteDocument("spots", {_id: id}), databaseMethods.deleteManyDocuments("spotimages", {spotId: id}), databaseMethods.deleteManyDocuments("comment", {spotId: id}), databaseMethods.deleteManyDocuments("likes", {spotId: id})])
    .then(res => {
        response.json({status: "SUCCESS", message: "Spot Deleted"})
    })
    .catch(error => {
        response.json({status: "ERROR", message: "Error deleting spot"})
    })
})

app.post('/updateProfileImage', async (request, response) => {
    await databaseMethods.makeUpdate("users", {username: request.session.username}, {
        $set: {
            profileImage: request.body.profileImage
        }
    })
    .then(res => {
        response.json({status: "SUCCESS", message: "Profile image updated"})
    })
    .catch(error => {
        response.json({status: "ERROR", message: "Error updating profile Image"})
    })
})

// auth endpoints

app.get('/login', (request, response) => {
    response.render('login.ejs')
})

app.post('/login', limiter, async (request, response) => {
    const password = request.body.password
    await databaseMethods.getOne("users", {$or: [{email: request.body.username}, {username: request.body.username}]})
    .then(async res => {
        if (res === null) return response.json({status: "ERROR", message: "User not found"})
        let checkPass = await bcrypt.compare(password, res.password)
        if(checkPass) {
            if (res.settings.twoFactorAuth === true) {
                let token = appFuncs.generateToken(7)
                const currentTime = new Date()
                request.session.tfaToken = token
                request.session.tfaTokenExpiry = currentTime.getTime() + 180000
                request.session.tempEmail = res.email
                request.session.toRemember = request.body.rememberme
                let content = `<h1>Login Verification</h1> <p>Your Skate App Login token is ${token}</p>`
                let mailresult = await appFuncs.sendPrimaryMail(res.email, "Skate App Login Verification", content)
                if (mailresult === "Error sending mail") {
                    return response.json({status: "ERROR", message: "Error sending mail"})
                }
                return response.json({status: "SUCCESS", message: "Redirecting...", action: "tfa"})
            } else {
                if (request.body.rememberme) {
                    request.session.cookie.maxAge = 604800000
                }
                request.session.username = res.username
                request.session.userID = res._id.toString()
                request.session.email = res.email
                request.session.isLoggedIn = true
                request.session.darkMode = res.settings.darkMode ? "true" : "false"
                return response.json({status: "SUCCESS", message: "Login successful, redirecting...", action: "login"})
            }
        } else {
            response.json({status: "ERROR", message: "Password missmatch"})
        }
    })
    .catch(error => {
        response.json({status: "ERROR", message: "Error with login"})
    })
})

app.get("/twoFactorAuth", async (request, response) => {
    if (!request.session.tempEmail) {
        return response.redirect("/login")
    }
    let duration = 0
    if (!request.session.tfaToken) {
        let token = appFuncs.generateToken(7)
        let currentTime = new Date()
        request.session.tfaToken = token
        request.session.tfaTokenExpiry = currentTime.getTime() + 180000
        duration = request.session.tfaTokenExpiry - currentTime.getTime()
        // let content = `<h1>Verify Account</h1> <p>Your Skate App verification token is ${token}</p>`
        let content = `<h1>Login Verification</h1> <p>Your Skate App Login token is ${token}</p>`
        let mailresult = await appFuncs.sendPrimaryMail(request.session.tempEmail, "Skate App Account Verification", content)
        if (mailresult === "Error sending mail") {
            // return response.json({status: "ERROR", message: "Error sending mail"})
            return response.redirect("/login")
        }
    }
    let currentTime = new Date()
    duration = request.session.tfaTokenExpiry - currentTime.getTime()
    let expired = false
    if (duration < 0) {
        request.session.tfaToken = null
        expired = true
        // duration = request.session.tfaTokenExpiry - currentTime.getTime()
    }
    response.render('twoFactorAuth.ejs', {duration: duration, expired: expired})
})

app.post("/twoFactorAuth", limiter, async (request, response) => {
    if (!request.session.tempEmail) {
        return response.redirect("/login")
    }
    let tempEmail = request.session.tempEmail
    let token = request.session.tfaToken
    let sentToken = request.body.sentToken
    let currentTime = new Date()
    let duration = request.session.tfaTokenExpiry - currentTime.getTime()
    let action = request.body.action
    if (action === "checkToken") {
        if(duration < 0) {
            request.session.tfaToken = null
            response.json({status: "ERROR", message: "Token Expired, try again"})
        } else if (token === sentToken && duration > 0) {
            await databaseMethods.getOne("users", {email: tempEmail})
            .then(res => {
                request.session.tfaToken = null
                request.session.tfaTokenExpiry = null
                request.session.username = res.username
                request.session.userID = res._id.toString()
                request.session.email = res.email
                request.session.isLoggedIn = true
                request.session.darkMode = res.settings.darkMode ? "true" : "false"
                response.json({status: "SUCCESS", message: "Token Match"})
            })
            .catch(error => {
                response.json({status: "ERROR", message: "Error updating user"})
            })

        } else {
            response.json({status: "ERROR", message: "Token Missmatch"})
        }
    } else if (action === "resendToken") {
        let token = appFuncs.generateToken(7)
        request.session.tfaToken = token
        let currentTime = new Date()
        request.session.tfaTokenExpiry = currentTime.getTime() + 180000
        duration = request.session.tfaTokenExpiry - currentTime.getTime()
        let content = `<h1>Verify Account</h1> <p>Your Skate App verification token is ${token}</p>`
        let mailresult = await appFuncs.sendPrimaryMail(request.session.tempEmail, "Skate App Account Verification", content)
        if (mailresult === "Error sending mail") {
            return response.json({status: "ERROR", message: "Error sending mail"})
        }
        response.json({status: "SUCCESS", message: "Token resent", duration: duration})
    }
})

app.get("/forgotPassword", async (request, response) => {
    if(!request.session.passwordResetStep) {
        request.session.passwordResetStep = "sendemail"
    }
    let duration = 0
    let expired = false
    if (request.session.fpToken) {
        let currentTime = new Date()
        duration = request.session.fpTokenExpiry - currentTime.getTime()
        if (duration < 0) {
            request.session.fpToken = null
            expired = true
        }
    }
    response.render("forgotPassword.ejs", {resetStep: request.session.passwordResetStep, duration: duration, expired: expired})
})

app.post("/forgotPassword", limiter, async (request, response) => {
    let action = request.body.action
    if (action === "sendemail") {
        let email = request.body.email
        await databaseMethods.getOne("users", {email: email})
        .then(async res => {
            if (res === null) {
                return response.json({status: "ERROR", message: `Could not find account with email ${email}`})
            }
            if (res.verified === false) {
                return response.json({status: "ERROR", message: `Email ${email} is not verified`})
            }
            request.session.fpEmail = email
            request.session.passwordResetStep = "resetpassword"
            let token = appFuncs.generateToken(7)
            let currentTime = new Date()
            request.session.fpToken = token
            request.session.fpTokenExpiry = currentTime.getTime() + 180000
            duration = request.session.fpTokenExpiry - currentTime.getTime()
            let content = `<h1>Reset Account Password</h1> <p>Your Skate App reset token is ${token}</p>`
            let mailresult = await appFuncs.sendPrimaryMail(email, "Skate App password reset", content)
            if (mailresult === "Error sending mail") {
                return response.json({status: "ERROR", message: "Error sending mail"})
            }
            response.json({status: "SUCCESS", message: "Token sent", duration: duration})
        })
        .catch(error => {
            return response.json({status: "ERROR", message: `Error getting user`})
        })
    } else if (action === "resetpassword") {
        // request.session.passwordResetStep = "resetpassword"
        if (!request.session.fpEmail && request.session.fpEmail != "") {
            request.session.passwordResetStep = "sendemail"
            return response.json({status: "ERROR", message: `Error getting email`})
        }
        let email = request.session.fpEmail
        let token = request.body.token
        let newpassword = request.body.newpassword
        let confirmnewpassword = request.body.confirmnewpassword
        let currentTime = new Date()
        let duration = request.session.fpTokenExpiry - currentTime.getTime()
        if (duration < 0) {
            request.session.fpToken = null
            return response.json({status: "ERROR", message: "Token expired"})
        }
        if (newpassword !== confirmnewpassword) {
            return response.json({status: "ERROR", message: "Password missmatch"})
        }
        if (token !== request.session.fpToken) {
            return response.json({status: "ERROR", message: "token missmatch"})
        }
        const hashedPass = await bcrypt.hash(newpassword, saltRounds)
        await databaseMethods.makeUpdate("users", {email: email}, {
            $set: {password: hashedPass}
        })
        .then(res => {
            response.json({status: "SUCCESS", message: "Password reset successful"})
        })
        .catch(error => {
            response.json({status: "ERROR", message: "Error with password reset"})
        })
    } else if (action === "resendToken") {
        if (!request.session.fpEmail && request.session.fpEmail != "") {
            request.session.passwordResetStep = "sendemail"
            return response.json({status: "ERROR", message: `Error getting email`})
        }
        let email = request.session.fpEmail
        let token = appFuncs.generateToken(7)
        let currentTime = new Date()
        request.session.fpToken = token
        request.session.fpTokenExpiry = currentTime.getTime() + 180000
        duration = request.session.fpTokenExpiry - currentTime.getTime()
        let content = `<h1>Reset Account Password</h1> <p>Your Skate App reset token is ${token}</p>`
        let mailresult = await appFuncs.sendPrimaryMail(email, "Skate App password reset", content)
        if (mailresult === "Error sending mail") {
            return response.json({status: "ERROR", message: "Error sending mail"})
        }
        response.json({status: "SUCCESS", message: "Token resent", duration: duration})
    } else {
        response.json({status: "ERROR", message: "Error with password reset"})
    }
})

app.post("/changePassword", limiter, async (request, response) => {
    if (request.body.newpassword !== request.body.confirmnewpassword) {
        return response.json({status: "ERROR", message: "New password missmatch"})
    }
    let userId = ObjectId.createFromHexString(request.session.userID)
    await databaseMethods.getOne("users", {_id: userId})
    .then(async res => {
        // let hashedPassOld = await bcrypt.hash(request.body.oldpassword, saltRounds)
        let passwordMatch = await bcrypt.compare(request.body.oldpassword, res.password)
        if (!passwordMatch) {
            return "Password missmatch"
        }
        let hashedPassNew = await bcrypt.hash(request.body.newpassword, saltRounds)
        return databaseMethods.makeUpdate("users", {_id: userId}, {$set: {password: hashedPassNew}})
    })
    .then(res => {
        if (res === "Password missmatch") {
            return response.json({status: "ERROR", message: "Password missmatch"})
        }
        return response.json({status: "SUCCESS", message: "Updated password"})
    })
    .catch(error => {
        response.json({status: "ERROR", message: "Error updating password"})
    })
})

app.get('/signup', (request, response) => {
    response.render('signup.ejs')
})

app.post('/signup', limiter, async (request, response) => {
    if (request.body.password !== request.body.confirmpassword) {return response.json({status: "ERROR", message: "Password Missmatch"})}
    const date = new Date()
    // await Promise.all([databaseMethods.getOne("users", {email: request.body.email}), databaseMethods.getOne("users", {username: request.body.username})])
    await databaseMethods.getOne("users", {$or: [{email: request.body.email}, {username: request.body.username}]})
    .then(async res => {
        // if (res !== null) {return response.json({status: "ERROR", message: "An account withthis email or username already exists"})}
        if (res !== null) {return "user exists"}
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
            dateCreated: currentDate[0]
        }
        return user
    })
    .then(async res => {
        console.log(res)
        if (res === "user exists") {return "user exists"}
        return databaseMethods.addOne("users", res)
    })
    .then(async res => {
        if (res === "user exists") {return response.json({status: "ERROR", message: "An account withthis email or username already exists"})}
        request.session.username = request.body.username
        request.session.userID = res.insertedId.toString()
        request.session.email = request.body.email
        request.session.darkMode = "false"
        request.session.isLoggedIn = true
        if (request.body.rememberme) {
            request.session.cookie.maxAge = 604800000
        }
        let token = appFuncs.generateToken(7)
        let currentTime = new Date()
        request.session.verifyToken = token
        request.session.tokenExpiry = currentTime.getTime() + 180000
        let content = `<h1>Verify Account</h1> <p>Your Skate App verification token is ${token}</p>`
        // let mailresult = await sendTokenFlow(request, token, "Skate App Account Verification", content)
        response.json({status: "SUCCESS", message: "Created user", email: request.body.email})
    })
    .catch(error => {
        response.json({status: "ERROR", message: "Error getting user"})
    })
})

app.get("/verify", async (request, response) => {
    if (request.session.email === undefined || request.session.email === null) {
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
        let mailresult = await appFuncs.sendPrimaryMail(request.session.email, "Skate App Account Verification", content)
        if (mailresult === "Error sending mail") {
            return response.json({status: "ERROR", message: "Error sending mail"})
        }
    }
    let currentTime = new Date()
    duration = request.session.tokenExpiry - currentTime.getTime()
    let expired = false
    if (duration < 0) {
        request.session.verifyToken = null
        expired = true
        duration = request.session.tokenExpiry - currentTime.getTime()
    }
    response.render("verify.ejs", {duration: duration, expired: expired})
})

app.post("/verify", limiter, async (request, response) => {
    if (request.session.email === undefined || request.session.email === null) {
        return response.redirect("/login")
    }
    let token = request.session.verifyToken
    let sentToken = request.body.sentToken
    let currentTime = new Date()
    let duration = request.session.tokenExpiry - currentTime.getTime()
    let action = request.body.action
    if (action === "checkToken") {
        if(duration < 0) {
            response.json({status: "ERROR", message: "Token Expired, try again"})
        } else if (token === sentToken && duration > 0) {
            let ID = ObjectId.createFromHexString(request.session.userID)
            await databaseMethods.makeUpdate("users", {_id: ID}, {
                $set: {
                    verified: true
                }
            })
            .then(verifiedRes => {
                request.session.verifyToken = null
                request.session.tokenExpiry = null
                response.json({status: "SUCCESS", message: "Token Match"})
            })
            .catch(error => {
                response.json({status: "ERROR", message: "Error updating user"})
            })

        } else {
            response.json({status: "ERROR", message: "Token Missmatch"})
        }
    } else if (action === "resendToken") {
        let token = appFuncs.generateToken(7)
        request.session.verifyToken = token
        // let currentTime = new Date()
        request.session.tokenExpiry = currentTime.getTime() + 180000
        duration = request.session.tokenExpiry - currentTime.getTime()
        let content = `<h1>Verify Account</h1> <p>Your Skate App verification token is ${token}</p>`
        let mailresult = await appFuncs.sendPrimaryMail(request.session.email, "Skate App Account Verification", content)
        if (mailresult === "Error sending mail") {
            return response.json({status: "ERROR", message: "Error sending mail"})
        }
        response.json({status: "SUCCESS", message: "Token resent", duration: duration})
    }
})

app.get("/logout", (request, response) => {
    request.session.destroy()
    response.clearCookie("connect.sid")
    response.redirect("/login")
})

app.use((request, response, next) => {
    response.status(404).render("404.ejs")
})

app.listen(process.env.PORT, () => {
    console.log(`Started at http://localhost:${process.env.PORT}`)
})