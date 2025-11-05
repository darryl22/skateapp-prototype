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
const {MongoClient, ObjectId} = require("mongodb")
const MongoDBStore  = require("connect-mongodb-session")(session)
const store = new MongoDBStore ({
    uri: "mongodb://localhost:27017/skateapp",
    databaseName: "skateapp",
    collection: "mySessions"
})

const uri = process.env.MONGO_URI
const client = new MongoClient(uri)
const DatabaseMethods = require("./dbFunctions")
let databaseMethods = new DatabaseMethods()

app.set('view engine', 'ejs')
app.use(express.static('public'))
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
    origin: ["localhost:3001"]
}))

app.get('/', (request, response) => {
    if (request.session.user === undefined) {
        request.session.user = "anonymous"
    } else {
        response.locals.user = request.session.user
    }
    // request.session.testitem2 = "test"
    response.render('index.ejs', {user: request.session.user})
})

app.get('/map', async (request, response) => {
    await Promise.all([databaseMethods.getMany("spots"), databaseMethods.getOne("users", {email: request.session.user})])
    .then(res => {
        console.log(res[1])
        let userObject = {
            username: "anonymous",
        }
        if (res[1] !== null) {
            userObject.username = res[1].username
            userObject.preferences = res[1].preferences
        }
        response.render('map.ejs', {mapboxtoken : process.env.MAPBOX_ACCESS_TOKEN, user: userObject, spots: res[0]})
    })
    .catch(error => {
        console.log(error)
        response.redirect("/")
    })
})

app.post('/addspot', async (request, response) => {
    const date = new Date()
    let data = {
        description: request.body.description,
        spottype: request.body.spottype,
        longitude: request.body.lng,
        latitude: request.body.lat,
        spotimages: request.body.spotimages,
        createdAt: date,
        createdBy: request.session.user
    }
    await databaseMethods.addOne("spots", data)
    .then(res => {
        console.log(res)
    })
    .catch(error => {
        console.log(error)
        response.redirect("/map")
    })

    response.redirect("/map")
})

app.get('/info', (request, response) => {
    response.render('info.ejs')
})

app.get('/profile', async (request, response) => {
    await databaseMethods.getOne("users", {email: request.session.user})
    .then(res => {
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
            }
        }
        response.render('profile.ejs', {user: userProfile})
    })
})

app.post('/updateProfile', async (request, response) => {
    try{
        userID = request.session.userID
        idObject = ObjectId.createFromHexString(userID)
        user = await databaseMethods.getOne("users", {_id: idObject})
        console.log(request.body)
        update = await databaseMethods.makeUpdate("users", {_id: idObject}, {
            $set: {
                username: "user556",
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
        console.log("User update", update)
        // console.log("UserId", request.session.userID)
        // console.log(user)
        // response.redirect("/profile")
        response.json({success: "true"})
    } catch (error) {
        console.log(error)
        // response.redirect("/profile")
        response.json({
            success: "false"
        })
    }
})

app.get('/login', (request, response) => {
    response.render('login.ejs', {user: request.session.user})
})

app.post('/login', async (request, response) => {
    const password = request.body.password
    await databaseMethods.getOne("users", {email: request.body.email})
    .then(res => {
        console.log(cryptr.decrypt(res.password))
        if(password === cryptr.decrypt(res.password)) {
            request.session.user = res.email
            request.session.userID = res._id.toString()
            response.redirect("/profile")
        } else {
            console.log("wrong password")
            response.redirect("/login")
        }
    })
    .catch(error => {
        console.log(error)
        response.redirect("/login")
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
        .then(res => {
            console.log("Check users", res)
            if (res[0] === null && res[1] === null) {
                const encryptedpass = cryptr.encrypt(password)
                const user = {
                    username: username,
                    email: email,
                    password: encryptedpass,
                    preferences: {
                        param1: true,
                        param2: true,
                        param3: true
                    },
                    preferences2: {
                        param1: true,
                        param2: false,
                        param3: false
                    }
                }
                // await databaseMethods.addOne("users", user)
                // .then(res => {
                //     console.log(res)
                //     response.redirect("/profile")
                // })
                // .catch(error => {
                //     console.log(error)
                //     response.redirect("/signup")
                // })
                response.redirect("/signup")
            } else if (res[0] !== null) {
                console.log("This email already exists")
                response.redirect("/signup")
            } else if (res[1] !== null) {
                console.log("This username already exists")
                response.redirect("/signup")
            }
        })
    } else {
        console.log("Password Missmatch")
        response.redirect("/signup")
    }
})

app.get("/logout", (request, response) => {
    request.session.user = "anonymous"
    response.redirect("/login")
})

app.listen(port, () => {
    console.log(`Listening on port ${port}`)
})