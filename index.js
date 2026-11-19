import express from 'express';
import cors from 'cors';
import 'dotenv/config'
import { MongoClient, ObjectId } from 'mongodb';



const app = express()
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());


const client = new MongoClient(process.env.MONGODB_URL);

export async function connectToMongoDB() {
    try {
        await client.connect();
        console.log("You successfully connected to MongoDB!");
        return client;
    } catch (err) {
        console.dir(err);
    }
}

const connectedClient = await connectToMongoDB();
const database = connectedClient.db("mentorlagbe");
const users = database.collection("user");
const tuitions = database.collection("tuitions");
const applications = database.collection("applications");
const payments = database.collection("payment");


app.get('/users', async (req, res) => {
    const cursor = users.find({});
    const results = await cursor.toArray();
    res.send(results);
});


app.post('/tuition', async (req, res) => {
    try {
        const tutorData = req.body;

        const newTutor = {
            ...tutorData,
            approvalStatus: 'pending',
            isActive: true,
            createdAt: new Date()
        };

        const result = await tuitions.insertOne(newTutor);

        res.send({
            success: true,
            message: 'Tuition posted successfully',
            result
        });

    } catch (error) {
        res.status(500).send({
            success: false,
            message: 'Failed to post tuition',
            error: error.message
        });
    }
});

app.get('/tuitions/:id', async (req, res) => {
    try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
            return res.status(400).send({
                success: false,
                message: "Invalid tuition ID"
            });
        }

        const query = { _id: new ObjectId(id) };
        const result = await tuitions.findOne(query);

        if (!result) {
            return res.status(404).send({
                success: false,
                message: "Tuition not found"
            });
        }

        res.send(result);

    } catch (error) {
        res.status(500).send({
            success: false,
            message: "Failed to get tuition"
        });
    }
});

app.get('/tuitions', async (req, res) => {
    try {
        const result = await tuitions.find({}).toArray()
        res.send(result)
    } catch (error) {
        res.status(500).send({
            success: false,
            message: "Failed to get tuitions"
        });
    }
});

app.get('/my-tuitions/:teacherId', async (req, res) => {
    try {
        const teacherId = req.params.teacherId;

        const query = { teacherId: teacherId };

        const result = await tuitions.find(query).toArray();

        res.send(result);

    } catch (error) {
        res.status(500).send({
            success: false,
            message: "Failed to get your tuitions",
            error: error.message
        });
    }
});

app.patch('/tuitions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { teacherId, ...submittedFields } = req.body;
        if (!ObjectId.isValid(id) || !teacherId) {
            return res.status(400).send({ success: false, message: 'A valid tuition ID and tutor ID are required' });
        }

        const allowedFields = ['title', 'subject', 'classLevel', 'mode', 'meetingLink', 'location', 'daysPerWeek', 'preferredTime', 'monthlyFee', 'description', 'bannerUrl'];
        const updates = Object.fromEntries(allowedFields.filter((key) => submittedFields[key] !== undefined).map((key) => [key, submittedFields[key]]));
        if (!Object.keys(updates).length) {
            return res.status(400).send({ success: false, message: 'No tuition fields were provided' });
        }

        const result = await tuitions.updateOne(
            { _id: new ObjectId(id), teacherId },
            { $set: { ...updates, approvalStatus: 'pending', updatedAt: new Date() } }
        );
        if (!result.matchedCount) {
            return res.status(404).send({ success: false, message: 'Tuition not found or you do not own this post' });
        }
        res.send({ success: true, message: 'Tuition updated and sent for review' });
    } catch (error) {
        res.status(500).send({ success: false, message: 'Failed to update tuition' });
    }
});

app.delete('/tuitions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { teacherId } = req.body;
        if (!ObjectId.isValid(id) || !teacherId) {
            return res.status(400).send({ success: false, message: 'A valid tuition ID and tutor ID are required' });
        }

        const result = await tuitions.deleteOne({ _id: new ObjectId(id), teacherId });
        if (!result.deletedCount) {
            return res.status(404).send({ success: false, message: 'Tuition not found or you do not own this post' });
        }
        await applications.deleteMany({ tuitionId: id, teacherId });
        res.send({ success: true, message: 'Tuition deleted' });
    } catch (error) {
        res.status(500).send({ success: false, message: 'Failed to delete tuition' });
    }
});

app.get('/tutor/applications/:teacherId', async (req, res) => {
    try {
        const result = await applications
            .find({ teacherId: req.params.teacherId })
            .sort({ createdAt: -1 })
            .toArray();
        res.send(result);
    } catch (error) {
        res.status(500).send({
            success: false,
            message: 'Failed to get tutor applications'
        });
    }
});



app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})  
