const express = require("express")
const app = express()
const port = 3000
require("dotenv").config()
const bodyParser = require("body-parser")
const fs = require("fs")

const Cryptr = require("cryptr")
const cryptr = new Cryptr(process.env.ENCRYPTION_KEY)
const cors = require("cors")
const {MongoClient} = require("mongodb")
const session = require("express-session")
const MongoDBStore  = require("connect-mongodb-session")(session)
const store = new MongoDBStore ({
    uri: "mongodb://localhost:27017/skateapp",
    databaseName: "skateapp",
    collection: "mySessions"
})

const uri = process.env.MONGO_URI
const client = new MongoClient(uri)

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

app.get('/map', (request, response) => {
    const date = new Date()
    if (request.session.user === undefined) {
        request.session.user = "anonymous"
    } else {
        response.locals.user = request.session.user
    }

    async function db() {
        try{
            const database = client.db("skateapp")
            const spots = database.collection("spots")
            let res = await spots.find().toArray()
            // console.log(res)
            response.render('map.ejs', {mapboxtoken : process.env.MAPBOX_ACCESS_TOKEN, user: request.session.user, spots: res})
        } catch (error) {
            console.log(error)
            response.redirect("/")
        }
    }
    db()
})

app.post('/addspot', (request, response) => {
    console.log(request.body.spotimages)
    const date = new Date()
    // console.log(date)
    async function db() {
        try {
            const database = client.db("skateapp")
            const spots = database.collection("spots")
            const res = await spots.insertOne({
                description: request.body.description,
                spottype: request.body.spottype,
                longitude: request.body.lng,
                latitude: request.body.lat,
                spotimages: request.body.spotimages,
                createdAt: date
            })
            console.log(res)
        } catch (error) {
            console.log(error)
        }
    }
    db()

    // const reader = fs.readFileSync(request.body.images[0], {encoding: 'base64'})
    // console.log(reader)
    response.redirect("/map")
})

app.get('/info', (request, response) => {
    response.render('info.ejs')
})

app.get('/profile', (request, response) => {
    async function db() {
        try {
            const database = client.db("skateapp")
            const users = database.collection("users")
            const res = await users.findOne({email: request.session.user})
            console.log(res._id.toString())
            
        } catch (err){
            console.log(err)
            response.redirect("/login")
        }
    }
    db()
    response.render('profile.ejs', {user: request.session.user})
})

app.get('/login', (request, response) => {
    response.render('login.ejs', {user: request.session.user})
})

app.post('/login', (request, response) => {
    const password = request.body.password
    async function db() {
        try {
            const database = client.db("skateapp")
            const users = database.collection("users")
            const res = await users.findOne({email: request.body.email})
            console.log(cryptr.decrypt(res.password))
            if(password === cryptr.decrypt(res.password)) {
                request.session.user = res.email
                response.redirect("/profile")
            } else {
                console.log("wrong password")
                response.redirect("/login")
            }
        } catch (err){
            console.log(err)
            response.redirect("/login")
        }
    }
    db()
})

app.get('/signup', (request, response) => {
    response.render('signup.ejs', {user: request.session.user})
})

app.post('/signup', (request, response) => {
    const username = request.body.username
    const email = request.body.email
    const password = request.body.password
    const confirmpassword = request.body.confirmpassword
    if (password === confirmpassword) {
        const encryptedpass = cryptr.encrypt(password)
        async function adduser() {
            try {
                const database = client.db("skateapp")
                const users = database.collection("users")
                const user = {
                    username: username,
                    email: email,
                    password: encryptedpass
                }
                const result = await users.insertOne(user)
                console.log("document inserted")
            } catch(error) {
                console.log(error)
            }
        }
        adduser()
        response.redirect("/profile")
    } else {
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