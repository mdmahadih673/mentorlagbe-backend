import express from 'express';
import cors from 'cors';
import 'dotenv/config'
import { MongoClient, ObjectId } from 'mongodb';
import Stripe from 'stripe'


const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey) throw new Error('Missing STRIPE_SECRET_KEY in backend .env');
const stripe = new Stripe(stripeSecretKey);


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
const payments = database.collection("payments");

async function getTransactionsByRole(role, res) {
    try {
        const paymentsForRole = await payments.find(
            { userRole: { $regex: `^${role}$`, $options: 'i' } },
            {
                projection: {
                    userId: 1,
                    userName: 1,
                    userEmail: 1,
                    customer_email: 1,
                    userRole: 1,
                    planName: 1,
                    amount: 1,
                    currency: 1,
                    transactionId: 1,
                    payment_intent: 1,
                    paymentStatus: 1,
                    payment_status: 1,
                    paidAt: 1,
                    payment_date: 1,
                    stripeSessionId: 1,
                    sessionId: 1,
                },
            }
        ).sort({ paidAt: -1, payment_date: -1 }).toArray();

        const data = paymentsForRole.map((payment) => ({
            ...payment,
            userEmail: payment.userEmail || payment.customer_email || '',
            transactionId: payment.transactionId || payment.payment_intent || '',
            paymentStatus: payment.paymentStatus || payment.payment_status || '',
            paidAt: payment.paidAt || payment.payment_date || null,
            stripeSessionId: payment.stripeSessionId || payment.sessionId || '',
        }));

        res.send({ success: true, data, total: data.length });
    } catch (error) {
        res.status(500).send({ success: false, message: `Failed to get ${role} transactions` });
    }
}

app.get('/admin/transactions/students', (req, res) => getTransactionsByRole('student', res));
app.get('/admin/transactions/tutors', (req, res) => getTransactionsByRole('tutor', res));

async function getTutorTuitionUsage(teacherId) {
    if (!ObjectId.isValid(teacherId)) return null;

    const user = await users.findOne(
        { _id: new ObjectId(teacherId) },
        { projection: { role: 1, plan: 1 } }
    );
    if (!user || user.role !== 'tutor') return null;

    const count = await tuitions.countDocuments({ teacherId });
    const plan = user.plan === 'pro' ? 'pro' : 'free';
    const limit = plan === 'pro' ? null : 2;

    return { count, plan, limit, remaining: limit === null ? null : Math.max(0, limit - count) };
}


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

app.post('/payments/checkout-vetify', async (req, res) => {
    try {
        const { sessionId, userId } = req.body;
        if (!sessionId || !userId || !ObjectId.isValid(userId)) {
            return res.status(400).send({ success: false, message: 'sessionId and a valid userId are required' });
        }

        const checkout = await stripe.checkout.sessions.retrieve(sessionId);
        if (
            checkout.status !== 'complete' ||
            checkout.payment_status !== 'paid' ||
            checkout.mode !== 'payment' ||
            checkout.client_reference_id !== userId ||
            checkout.metadata?.userId !== userId ||
            checkout.metadata?.userRole !== 'tutor'
        ) {
            return res.status(400).send({ success: false, message: 'Payment verification failed' });
        }

        const userObjectId = new ObjectId(userId);
        const user = await users.findOne({ _id: userObjectId, role: 'tutor' });
        if (!user) return res.status(404).send({ success: false, message: 'Tutor account not found' });

        const paymentIntent = checkout.payment_intent;
        const transactionId = typeof paymentIntent === 'string'
            ? paymentIntent
            : paymentIntent?.id || checkout.id;
        const paidAt = new Date(checkout.created * 1000);

        await payments.updateOne(
            { stripeSessionId: checkout.id },
            { $set: {
                stripeSessionId: checkout.id,
                transactionId,
                amount: (checkout.amount_total || 0) / 100,
                currency: (checkout.currency || 'usd').toUpperCase(),
                paymentStatus: 'paid',
                planName: 'Pro Tutor',
                userId,
                userEmail: checkout.customer_details?.email || checkout.customer_email || user.email || '',
                userName: user.name || 'Tutor',
                userRole: 'tutor',
                paidAt,
                updatedAt: new Date(),
            } },
            { upsert: true }
        );

        await users.updateOne(
            { _id: userObjectId, role: 'tutor' },
            { $set: { plan: 'pro', updatedAt: paidAt }, $unset: { premium: '' } }
        );

        res.send({ success: true, message: 'Payment verified and Pro plan activated' });
    } catch (error) {
        res.status(500).send({ success: false, message: 'Could not verify payment', error: error.message });
    }
})

app.post('/payments/student/checkout-verify', async (req, res) => {
    try {
        const { sessionId, userId } = req.body;
        if (!sessionId || !userId || !ObjectId.isValid(userId)) {
            return res.status(400).send({ success: false, message: 'sessionId and a valid userId are required' });
        }

        const checkout = await stripe.checkout.sessions.retrieve(sessionId);
        if (
            checkout.status !== 'complete' ||
            checkout.payment_status !== 'paid' ||
            checkout.mode !== 'payment' ||
            checkout.currency !== 'usd' ||
            checkout.amount_total !== 1000 ||
            checkout.client_reference_id !== userId ||
            checkout.metadata?.userId !== userId ||
            checkout.metadata?.userRole !== 'student'
        ) {
            return res.status(400).send({ success: false, message: 'Student payment verification failed' });
        }

        const userObjectId = new ObjectId(userId);
        const user = await users.findOne({ _id: userObjectId, role: 'student' });
        if (!user) return res.status(404).send({ success: false, message: 'Student account not found' });

        const paymentIntent = checkout.payment_intent;
        const transactionId = typeof paymentIntent === 'string'
            ? paymentIntent
            : paymentIntent?.id || checkout.id;
        const paidAt = new Date(checkout.created * 1000);

        await payments.updateOne(
            { stripeSessionId: checkout.id },
            { $set: {
                stripeSessionId: checkout.id,
                transactionId,
                amount: checkout.amount_total / 100,
                currency: checkout.currency.toUpperCase(),
                paymentStatus: 'paid',
                planName: 'Pro Student',
                userId,
                userEmail: checkout.customer_details?.email || checkout.customer_email || user.email || '',
                userName: user.name || 'Student',
                userRole: 'student',
                paidAt,
                updatedAt: new Date(),
            } },
            { upsert: true }
        );

        await users.updateOne(
            { _id: userObjectId, role: 'student' },
            { $set: { plan: 'pro', updatedAt: paidAt }, $unset: { premium: '' } }
        );

        res.send({ success: true, message: 'Student payment verified and Pro plan activated' });
    } catch (error) {
        res.status(500).send({ success: false, message: 'Could not verify student payment', error: error.message });
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


app.get('/tutor/tuition-count/:teacherId', async (req, res) => {
    try {
        const usage = await getTutorTuitionUsage(req.params.teacherId);
        if (!usage) {
            return res.status(404).send({ success: false, message: 'Tutor not found' });
        }

        res.send({ success: true, ...usage, canPost: usage.limit === null || usage.count < usage.limit });
    } catch (error) {
        res.status(500).send({ success: false, message: 'Failed to get tuition count' });
    }
});

app.post('/tuition', async (req, res) => {
    try {
        const tutorData = req.body;
        const teacherId = tutorData.teacherId;
        const usage = await getTutorTuitionUsage(teacherId);

        if (!usage) {
            return res.status(404).send({ success: false, message: 'Tutor not found' });
        }
        if (usage.limit !== null && usage.count >= usage.limit) {
            return res.status(403).send({
                success: false,
                message: 'Free plan allows up to 2 tuition posts. Upgrade to Pro to post more.',
                ...usage,
                canPost: false,
            });
        }

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
            result,
            count: usage.count + 1,
            plan: usage.plan,
            limit: usage.limit,
            remaining: usage.limit === null ? null : Math.max(0, usage.limit - usage.count - 1),
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

        if (q) filters.push({
            $or: ['title', 'subject', 'classLevel', 'tutorName']
                .map((field) => ({ [field]: { $regex: escape(q), $options: 'i' } }))
        });
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
            {
                $facet: {
                    data: [{ $sort: sortBy }, { $skip: (page - 1) * pageSize }, { $limit: pageSize }, { $unset: 'fee' }],
                    total: [{ $count: 'count' }],
                }
            },
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

app.get('/student/application-count/:studentId', async (req, res) => {
    try {
        const { studentId } = req.params;
        if (!ObjectId.isValid(studentId)) {
            return res.status(400).send({ success: false, message: 'Invalid student ID' });
        }

        const user = await users.findOne(
            { _id: new ObjectId(studentId), role: 'student' },
            { projection: { plan: 1 } }
        );
        if (!user) return res.status(404).send({ success: false, message: 'Student not found' });

        const [counts] = await applications.aggregate([
            { $match: { studentId } },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
                    accepted: { $sum: { $cond: [{ $eq: ['$status', 'accepted'] }, 1, 0] } },
                    rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
                    active: { $sum: { $cond: [{ $in: ['$status', ['pending', 'accepted']] }, 1, 0] } },
                },
            },
            { $project: { _id: 0 } },
        ]).toArray();

        const isPro = user.plan === 'pro';
        const limit = isPro ? null : 2;
        const activeApplications = counts?.active || 0;
        res.send({
            success: true,
            plan: isPro ? 'pro' : 'free',
            totalApplications: counts?.total || 0,
            pendingApplications: counts?.pending || 0,
            acceptedApplications: counts?.accepted || 0,
            rejectedApplications: counts?.rejected || 0,
            activeApplications,
            limit,
            remaining: limit === null ? null : Math.max(0, limit - activeApplications),
            canApply: limit === null || activeApplications < limit,
        });
    } catch (error) {
        res.status(500).send({ success: false, message: 'Failed to get student application count' });
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

        if (!ObjectId.isValid(studentId)) {
            return res.status(400).send({ success: false, message: 'Invalid student ID' });
        }

        const student = await users.findOne(
            { _id: new ObjectId(studentId), role: 'student' },
            { projection: { plan: 1 } }
        );
        if (!student) return res.status(404).send({ success: false, message: 'Student not found' });

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

        if (student.plan !== 'pro') {
            const activeCount = await applications.countDocuments({
                studentId,
                status: { $in: ['pending', 'accepted'] },
            });
            if (activeCount >= 2) {
                return res.status(403).send({
                    success: false,
                    message: 'Free plan allows up to 2 active tuition requests. Upgrade to Pro to send more.',
                    plan: 'free',
                    limit: 2,
                    remaining: 0,
                    canApply: false,
                });
            }
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
