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



app.delete('/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
            return res.status(400).send({ success: false, message: 'Invalid user ID' });
        }

        const userObjectId = new ObjectId(id);
        const user = await users.findOne({ _id: userObjectId });
        if (!user) {
            return res.status(404).send({ success: false, message: 'User not found' });
        }

        const ownedTuitions = await tuitions
            .find({ teacherId: id }, { projection: { _id: 1 } })
            .toArray();
        const tuitionIds = ownedTuitions.map((tuition) => String(tuition._id));

        await Promise.all([
            database.collection('session').deleteMany({ userId: userObjectId }),
            database.collection('account').deleteMany({ userId: userObjectId }),
            applications.deleteMany({
                $or: [
                    { studentId: id },
                    { teacherId: id },
                    ...(tuitionIds.length ? [{ tuitionId: { $in: tuitionIds } }] : []),
                ],
            }),
            tuitions.deleteMany({ teacherId: id }),
            users.deleteOne({ _id: userObjectId }),
        ]);

        res.send({ success: true, message: 'User and related records deleted' });
    } catch (error) {
        res.status(500).send({
            success: false,
            message: 'Failed to delete user',
            error: error.message,
        });
    }
});



app.patch('/users/:id/role', async (req, res) => {
    try {
        const { id } = req.params;
        const { role } = req.body;
        const allowedRoles = ['student', 'tutor', 'admin'];

        if (!ObjectId.isValid(id)) {
            return res.status(400).send({ success: false, message: 'Invalid user ID' });
        }
        if (!allowedRoles.includes(role)) {
            return res.status(400).send({ success: false, message: 'A valid role is required' });
        }

        const result = await users.updateOne(
            { _id: new ObjectId(id) },
            { $set: { role, updatedAt: new Date() }, $unset: { userType: '' } }
        );

        if (!result.matchedCount) {
            return res.status(404).send({ success: false, message: 'User not found' });
        }

        res.send({ success: true, message: 'User role updated', role });
    } catch (error) {
        res.status(500).send({
            success: false,
            message: 'Failed to update user role',
            error: error.message,
        });
    }
})

app.patch('/admin/tuitions/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const allowedStatuses = ['pending', 'approved', 'rejected'];

        if (!ObjectId.isValid(id)) {
            return res.status(400).send({ success: false, message: 'Invalid tuition ID' });
        }
        if (!allowedStatuses.includes(status)) {
            return res.status(400).send({ success: false, message: 'A valid listing status is required' });
        }

        const result = await tuitions.updateOne(
            { _id: new ObjectId(id) },
            { $set: { approvalStatus: status, updatedAt: new Date() } }
        );
        if (!result.matchedCount) {
            return res.status(404).send({ success: false, message: 'Tuition not found' });
        }

        res.send({ success: true, message: 'Tuition status updated', status });
    } catch (error) {
        res.status(500).send({ success: false, message: 'Failed to update tuition status' });
    }
});


app.delete('/admin/tuitions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
            return res.status(400).send({ success: false, message: 'Invalid tuition ID' });
        }

        const result = await tuitions.deleteOne({ _id: new ObjectId(id) });
        if (!result.deletedCount) {
            return res.status(404).send({ success: false, message: 'Tuition not found' });
        }

        await applications.deleteMany({ tuitionId: id });
        res.send({ success: true, message: 'Tuition and related applications deleted' });
    } catch (error) {
        res.status(500).send({ success: false, message: 'Failed to delete tuition' });
    }
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

app.get('/tuitions/search', async (req, res) => {
    try {
        const { q = '', location = '', sort = 'newest' } = req.query;
        const values = (key) => [].concat(req.query[key] || [])
            .flatMap((value) => String(value).split(',')).map((value) => value.trim()).filter(Boolean);
        const escape = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const filters = [];
        const subjects = values('subject');
        const modes = values('mode');
        const classes = values('class').flatMap((value) => ({
            'Class 6–8': ['Class 6', 'Class 7', 'Class 8'],
            'Class 9–10': ['Class 9', 'Class 10'],
        }[value] || [value]));
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize, 10) || 6));

        if (q) filters.push({ $or: ['title', 'subject', 'classLevel', 'tutorName']
            .map((field) => ({ [field]: { $regex: escape(q), $options: 'i' } })) });
        if (subjects.length) filters.push({ subject: { $in: subjects } });
        if (modes.length) filters.push({ mode: { $in: modes } });
        if (classes.length) filters.push({ classLevel: { $in: classes } });
        if (location) filters.push(location.toLowerCase() === 'online'
            ? { mode: 'Online' }
            : { mode: 'Offline', location: { $regex: escape(location), $options: 'i' } });
        const sortBy = { newest: { createdAt: -1 }, 'fee-low': { fee: 1 }, 'fee-high': { fee: -1 } }[sort] || { createdAt: -1 };
        const [result] = await tuitions.aggregate([
            ...(filters.length ? [{ $match: { $and: filters } }] : []),
            { $addFields: { fee: { $convert: { input: '$monthlyFee', to: 'double', onError: 0, onNull: 0 } } } },
            { $facet: {
                data: [{ $sort: sortBy }, { $skip: (page - 1) * pageSize }, { $limit: pageSize }, { $unset: 'fee' }],
                total: [{ $count: 'count' }],
            } },
        ]).toArray();
        const total = result?.total?.[0]?.count || 0;
        res.send({ success: true, data: result?.data || [], total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
    } catch (error) {
        res.status(500).send({ success: false, message: 'Failed to search tuition listings' });
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

app.get('/student/applications/:studentId', async (req, res) => {
    try {
        const result = await applications
            .find({ studentId: req.params.studentId })
            .sort({ createdAt: -1 })
            .toArray();
        const tutorIds = [...new Set(result.map((application) => application.teacherId).filter(Boolean))];
        const tutors = await users.find({ _id: { $in: tutorIds } }).project({ name: 1 }).toArray();
        const tutorNames = new Map(tutors.map((tutor) => [String(tutor._id), tutor.name]));
        res.send(result.map((application) => ({
            ...application,
            tutorName: tutorNames.get(application.teacherId) || application.tutorName || ''
        })));
    } catch (error) {
        res.status(500).send({ success: false, message: 'Failed to get student applications' });
    }
});

app.post('/applications', async (req, res) => {
    try {
        const { tuitionId, studentId, studentName, studentEmail, message, preferredTime } = req.body;

        if (!ObjectId.isValid(tuitionId) || !studentId || !studentName) {
            return res.status(400).send({
                success: false,
                message: 'Tuition ID, student ID, and student name are required'
            });
        }

        const tuition = await tuitions.findOne({ _id: new ObjectId(tuitionId) });
        if (!tuition) {
            return res.status(404).send({ success: false, message: 'Tuition not found' });
        }

        const existingRequest = await applications.findOne({
            tuitionId,
            studentId,
            status: { $in: ['pending', 'accepted'] }
        });
        if (existingRequest) {
            return res.status(409).send({
                success: false,
                message: 'You already have an active request for this tuition'
            });
        }

        const application = {
            tuitionId,
            teacherId: tuition.teacherId,
            tuitionTitle: tuition.title,
            subject: tuition.subject,
            studentId,
            studentName,
            studentEmail: studentEmail || '',
            message: typeof message === 'string' ? message.trim().slice(0, 1000) : '',
            preferredTime: typeof preferredTime === 'string' ? preferredTime.trim().slice(0, 120) : '',
            status: 'pending',
            createdAt: new Date()
        };

        const result = await applications.insertOne(application);
        res.status(201).send({
            success: true,
            message: 'Tuition request sent',
            applicationId: result.insertedId.toString()
        });
    } catch (error) {
        res.status(500).send({ success: false, message: 'Failed to send tuition request' });
    }
});


app.patch('/tutor/applications/:applicationId/status', async (req, res) => {
    try {
        const { applicationId } = req.params;
        const { teacherId, status } = req.body;
        const allowedStatuses = ['pending', 'accepted', 'rejected'];

        if (!ObjectId.isValid(applicationId)) {
            return res.status(400).send({ success: false, message: 'Invalid application ID' });
        }
        if (!teacherId || !allowedStatuses.includes(status)) {
            return res.status(400).send({ success: false, message: 'A tutor ID and valid status are required' });
        }

        const result = await applications.updateOne(
            { _id: new ObjectId(applicationId), teacherId },
            { $set: { status, updatedAt: new Date() } }
        );

        if (!result.matchedCount) {
            return res.status(404).send({ success: false, message: 'Application not found' });
        }

        res.send({ success: true, message: 'Application status updated', status });
    } catch (error) {
        res.status(500).send({ success: false, message: 'Failed to update application status' });
    }
});

app.delete('/tutor/applications/:applicationId', async (req, res) => {
    try {
        const { applicationId } = req.params;
        const { teacherId } = req.body;

        if (!ObjectId.isValid(applicationId)) {
            return res.status(400).send({ success: false, message: 'Invalid application ID' });
        }
        if (!teacherId) {
            return res.status(400).send({ success: false, message: 'A tutor ID is required' });
        }

        const result = await applications.deleteOne({
            _id: new ObjectId(applicationId),
            teacherId
        });

        if (!result.deletedCount) {
            return res.status(404).send({ success: false, message: 'Application not found' });
        }

        res.send({ success: true, message: 'Application deleted' });
    } catch (error) {
        res.status(500).send({ success: false, message: 'Failed to delete application' });
    }
});

app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})  
