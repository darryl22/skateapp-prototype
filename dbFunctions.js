const {MongoClient} = require("mongodb")
const uri = process.env.MONGO_URI
const client = new MongoClient(uri)
const {ObjectId} = require("mongodb")

class DatabaseMethods {
    async addOne(col, object) {
        try{
            const database = client.db("skateapp")
            const collection = database.collection(col)
            const res = await collection.insertOne(object)
            return res
        } catch (error) {
            console.log(error)
            return {}
        }
    }

    async addMultiple(col, object) {
        try{
            const database = client.db("skateapp")
            const collection = database.collection(col)
            const res = await collection.insertMany(object)
            return res
        } catch (error) {
            console.log(error)
            return {}
        }
    }

    async getOne(col, object) {
        try{
            const database = client.db("skateapp")
            const collection = database.collection(col)
            const res = await collection.findOne(object)
            return res
        } catch (error) {
            console.log(error)
            return {}
        }
    }

    async getMany(col, object) {
        try{
            if (object === undefined) {
                object = {}
            }
            const database = client.db("skateapp")
            const collection = database.collection(col)
            const res = await collection.find(object).toArray()
            return res
        } catch (error) {
            console.log(error)
            return {}
        }
    }

    async getManySorted(col, object, sort) {
        try{
            if (object === undefined) {
                object = {}
            }
            const database = client.db("skateapp")
            const collection = database.collection(col)
            const res = await collection.find(object).sort(sort).toArray()
            return res
        } catch (error) {
            console.log(error)
            return {}
        }
    }

    async makeUpdate(col, filter, update) {
        try{
            const database = client.db("skateapp")
            const collection = database.collection(col)
            const res = await collection.updateOne(filter, update)
            return res
        } catch (error) {
            console.log(error)
        }
    }

    async makeMultipleUpdates(col, filter, update) {
        try{
            const database = client.db("skateapp")
            const collection = database.collection(col)
            const res = await collection.updateMany(filter, update)
            return res
        } catch (error) {
            console.log(error)
        }
    }
    
    async deleteDocument(col, filter) {
        try{
            const database = client.db("skateapp")
            const collection = database.collection(col)
            const res = await collection.deleteOne(filter)
            return res
        } catch(error) {
            console.log(error)
        }
    }

    async deleteManyDocuments(col, filter) {
        try{
            const database = client.db("skateapp")
            const collection = database.collection(col)
            const res = await collection.deleteMany(filter)
            return res
        } catch(error) {
            console.log(error)
        }
    }
}

module.exports = DatabaseMethods
