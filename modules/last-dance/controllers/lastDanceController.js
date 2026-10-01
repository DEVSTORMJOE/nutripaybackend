const crypto = require('crypto');
const Candidate = require('../models/Candidate');
const TicketPurchase = require('../models/TicketPurchase');
const VoteTransaction = require('../models/VoteTransaction');
const LastDanceSettings = require('../models/LastDanceSettings');
const paymentGatewayService = require('../../../services/paymentGatewayService');
const { sendMail } = require('../../../utils/mailer');

// Helper to get or initialize system settings
const getOrCreateSettings = async () => {
    let settings = await LastDanceSettings.findOne({ key: 'global' });
    if (!settings) {
        settings = await LastDanceSettings.create({
            key: 'global',
            enabled: true,
            eventDate: '2026-10-26',
            eventTitle: 'Last Dance',
            tagline: 'One Last Night. One Last Dance.',
            ticketPriceKES: 500,
            votePackages: [
                { label: 'Single Vote', votes: 1, priceKES: 10, discountText: '', isPopular: false },
                { label: '10-Vote Power Pack', votes: 10, priceKES: 90, discountText: 'Save 10%', isPopular: true },
                { label: '25-Vote Boost Pack', votes: 25, priceKES: 200, discountText: 'Save 20%', isPopular: false },
                { label: '50-Vote Legend Pack', votes: 50, priceKES: 380, discountText: 'Save 24%', isPopular: false }
            ]
        });
    }
    return settings;
};

// 1. Get Settings / Config
exports.getSettings = async (req, res) => {
    try {
        const settings = await getOrCreateSettings();
        res.json({ success: true, settings });
    } catch (err) {
        console.error('[LastDance] getSettings error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

// 2. Admin Update Settings (e.g. Master Toggle ON/OFF)
exports.updateSettings = async (req, res) => {
    try {
        const { enabled, ticketPriceKES, tagline, eventDate, musicUrl, votePackages } = req.body;
        let settings = await getOrCreateSettings();

        if (typeof enabled === 'boolean') settings.enabled = enabled;
        if (ticketPriceKES && Number(ticketPriceKES) > 0) settings.ticketPriceKES = Number(ticketPriceKES);
        if (tagline) settings.tagline = tagline;
        if (eventDate) settings.eventDate = eventDate;
        if (typeof musicUrl === 'string') settings.musicUrl = musicUrl;
        if (Array.isArray(votePackages)) settings.votePackages = votePackages;

        await settings.save();
        res.json({ success: true, settings, message: 'Last Dance settings updated successfully' });
    } catch (err) {
        console.error('[LastDance] updateSettings error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

// 3. Get Public Candidates (Leaderboard) with Gap Stats
exports.getCandidates = async (req, res) => {
    try {
        const settings = await getOrCreateSettings();
        if (!settings.enabled && !req.user?.role) {
            return res.status(403).json({ success: false, disabled: true, message: 'Last Dance mode is currently disabled.' });
        }

        const { category } = req.query;
        const query = { isApproved: true };
        if (category && category !== 'All') {
            query.category = category;
        }

        const candidates = await Candidate.find(query).sort({ voteCount: -1, createdAt: 1 });

        // Calculate leaderboard stats & gap to #1 for each category
        // Find overall #1 candidate per category
        const categoryLeaders = {};
        const allCandidates = await Candidate.find({ isApproved: true }).sort({ voteCount: -1 });
        allCandidates.forEach(c => {
            if (!categoryLeaders[c.category]) {
                categoryLeaders[c.category] = c.voteCount;
            }
        });

        const formattedCandidates = candidates.map((c, index) => {
            const leaderVotes = categoryLeaders[c.category] || 0;
            const votesToOvertake = index === 0 || c.voteCount === leaderVotes ? 0 : (leaderVotes - c.voteCount + 1);

            return {
                ...c.toObject(),
                rank: index + 1,
                votesToOvertake
            };
        });

        res.json({
            success: true,
            candidates: formattedCandidates,
            categories: settings.categories
        });
    } catch (err) {
        console.error('[LastDance] getCandidates error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

// 4. Candidate Registration (100% Free, Frictionless)
exports.registerCandidate = async (req, res) => {
    try {
        const settings = await getOrCreateSettings();
        if (!settings.enabled) {
            return res.status(403).json({ success: false, message: 'Registration is currently closed.' });
        }

        const { name, photoUrl, oneLiner, pitch, category } = req.body;

        if (!name || !photoUrl || !oneLiner || !pitch || !category) {
            return res.status(400).json({ success: false, message: 'All profile fields are required.' });
        }

        if (!settings.categories.includes(category)) {
            return res.status(400).json({ success: false, message: 'Invalid candidate category selection.' });
        }

        const newCandidate = await Candidate.create({
            name,
            photoUrl,
            oneLiner,
            pitch,
            category,
            isApproved: false,
            voteCount: 0
        });

        res.status(201).json({
            success: true,
            candidate: newCandidate,
            message: 'Candidate registration submitted successfully! Your profile will appear once approved by admins.'
        });
    } catch (err) {
        console.error('[LastDance] registerCandidate error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

// 5. Buy Ticket STK Push
exports.buyTicket = async (req, res) => {
    try {
        const settings = await getOrCreateSettings();
        if (!settings.enabled) {
            return res.status(403).json({ success: false, message: 'Ticket sales are currently closed.' });
        }

        const { name, email, phone, quantity } = req.body;

        if (!name || !email || !phone || !quantity || Number(quantity) < 1) {
            return res.status(400).json({ success: false, message: 'Valid Name, Email, Phone number, and ticket Quantity required.' });
        }

        const qty = Number(quantity);
        const pricePerTicket = settings.ticketPriceKES || 500;
        const totalAmountKES = qty * pricePerTicket;

        // Clean phone number (254...)
        let cleanPhone = String(phone).trim().replace(/\+/g, '');
        if (cleanPhone.startsWith('0')) {
            cleanPhone = '254' + cleanPhone.slice(1);
        }

        // Initiate M-Pesa STK Push
        const dummyUserId = '000000000000000000000000'; // Guest dummy ID
        const stkResult = await paymentGatewayService.initiateDeposit(dummyUserId, cleanPhone, totalAmountKES);
        const checkoutRequestID = stkResult.CheckoutRequestID;

        // Save ticket purchase pending record
        await TicketPurchase.create({
            checkoutRequestID,
            buyerName: name.trim(),
            buyerEmail: email.trim().toLowerCase(),
            buyerPhone: cleanPhone,
            quantity: qty,
            pricePerTicketKES: pricePerTicket,
            totalAmountKES,
            status: 'pending'
        });

        res.json({
            success: true,
            message: `STK Push prompt sent to ${cleanPhone}. Please enter your M-Pesa PIN to complete payment of KES ${totalAmountKES}.`,
            checkoutRequestID,
            totalAmountKES
        });
    } catch (err) {
        console.error('[LastDance] buyTicket error:', err);
        res.status(500).json({ success: false, message: 'Ticket payment failed: ' + (err.message || 'M-Pesa service unavailable') });
    }
};

// 6. Cast Paid Vote STK Push
exports.castVote = async (req, res) => {
    try {
        const settings = await getOrCreateSettings();
        if (!settings.enabled) {
            return res.status(403).json({ success: false, message: 'Voting is currently closed.' });
        }

        const { candidateId, votesCount, phone } = req.body;

        if (!candidateId || !votesCount || !phone) {
            return res.status(400).json({ success: false, message: 'Candidate ID, Votes count, and M-Pesa Phone number required.' });
        }

        const candidate = await Candidate.findById(candidateId);
        if (!candidate || !candidate.isApproved) {
            return res.status(404).json({ success: false, message: 'Approved candidate not found.' });
        }

        const qty = Number(votesCount);
        // Find selected package or calculate unit price (10 KES per vote base)
        const pkg = settings.votePackages.find(p => p.votes === qty);
        const amountKES = pkg ? pkg.priceKES : (qty * 10);
        const packageLabel = pkg ? pkg.label : `${qty} Votes`;

        let cleanPhone = String(phone).trim().replace(/\+/g, '');
        if (cleanPhone.startsWith('0')) {
            cleanPhone = '254' + cleanPhone.slice(1);
        }

        const dummyUserId = '000000000000000000000000';
        const stkResult = await paymentGatewayService.initiateDeposit(dummyUserId, cleanPhone, amountKES);
        const checkoutRequestID = stkResult.CheckoutRequestID;

        await VoteTransaction.create({
            checkoutRequestID,
            candidate: candidate._id,
            voterPhone: cleanPhone,
            votesCount: qty,
            amountKES,
            packageLabel,
            status: 'pending'
        });

        res.json({
            success: true,
            message: `STK Push prompt sent to ${cleanPhone}. Please enter your M-Pesa PIN to cast ${qty} votes for ${candidate.name}!`,
            checkoutRequestID,
            amountKES
        });
    } catch (err) {
        console.error('[LastDance] castVote error:', err);
        res.status(500).json({ success: false, message: 'Vote payment failed: ' + (err.message || 'M-Pesa service unavailable') });
    }
};

// 7. Check Payment Status (Polling endpoint for tickets & votes)
exports.checkPaymentStatus = async (req, res) => {
    try {
        const { checkoutRequestID } = req.params;

        const ticket = await TicketPurchase.findOne({ checkoutRequestID });
        if (ticket) {
            return res.json({ success: true, type: 'ticket', status: ticket.status, details: ticket });
        }

        const vote = await VoteTransaction.findOne({ checkoutRequestID }).populate('candidate');
        if (vote) {
            return res.json({ success: true, type: 'vote', status: vote.status, details: vote });
        }

        res.status(404).json({ success: false, message: 'Transaction record not found.' });
    } catch (err) {
        console.error('[LastDance] checkPaymentStatus error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

// 8. Payment Webhook Callback Callback Handler
exports.handlePaymentCallback = async (req, res) => {
    try {
        console.log('[LastDance Webhook] Received callback:', JSON.stringify(req.body, null, 2));

        const paymentGatewayService = require('../../services/paymentGatewayService');
        const verification = paymentGatewayService.verifyCallback(req.body);
        const { checkoutRequestID, merchantRequestID, externalReference, success, mpesaReceiptNumber, amountPaid } = verification;

        const lookupKeys = [checkoutRequestID, merchantRequestID, externalReference].filter(Boolean);

        // A. Check if it's a Ticket Purchase
        const ticketOrder = await TicketPurchase.findOne({ checkoutRequestID: { $in: lookupKeys } });
        if (ticketOrder) {
            if (!success) {
                ticketOrder.status = 'failed';
                await ticketOrder.save();
                console.log(`[LastDance] Ticket order ${ticketOrder._id} payment failed.`);
                return res.json({ ResponseCode: '0', ResponseDesc: 'Success' });
            }

            if (ticketOrder.status === 'completed') {
                return res.json({ ResponseCode: '0', ResponseDesc: 'Already processed' });
            }

            // Mark completed
            ticketOrder.status = 'completed';
            ticketOrder.mpesaReceiptNumber = mpesaReceiptNumber || `LD-${Date.now()}`;

            // Generate unique tickets with QR codes
            const generatedTickets = [];
            for (let i = 0; i < ticketOrder.quantity; i++) {
                const code = `LD-2026-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(code)}`;
                generatedTickets.push({
                    ticketCode: code,
                    qrCodeUrl: qrUrl
                });
            }
            ticketOrder.tickets = generatedTickets;
            await ticketOrder.save();

            // Dispatch digital HTML email ticket
            try {
                const htmlTickets = generatedTickets.map((t, idx) => `
                    <div style="background: #0f172a; border: 2px dashed #e11d48; border-radius: 12px; padding: 20px; margin: 15px 0; color: #ffffff; text-align: center;">
                        <p style="margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: #fb7185; font-weight: 700;">Ticket #${idx + 1} of ${ticketOrder.quantity}</p>
                        <h3 style="margin: 6px 0; font-size: 22px; color: #ffffff;">Last Dance - Graduation Eve</h3>
                        <div style="font-family: monospace; font-size: 20px; font-weight: 800; color: #fbbf24; letter-spacing: 3px; margin: 10px 0; padding: 8px; background: rgba(255,255,255,0.05); border-radius: 6px;">
                            ${t.ticketCode}
                        </div>
                        <img src="${t.qrCodeUrl}" alt="Ticket QR Code" style="width: 180px; height: 180px; border-radius: 8px; border: 4px solid #ffffff; margin: 10px 0;" />
                        <p style="margin: 6px 0 0 0; font-size: 12px; color: #94a3b8;">Present this QR code at the entrance on October 26th.</p>
                    </div>
                `).join('');

                const emailHtml = `
                    <!DOCTYPE html>
                    <html>
                    <head><meta charset="utf-8"></head>
                    <body style="font-family: 'Segoe UI', Arial, sans-serif; background-color: #020617; margin: 0; padding: 20px;">
                        <div style="max-width: 600px; margin: 0 auto; background-color: #090d16; border-radius: 16px; border: 1px solid #1e293b; overflow: hidden; padding: 30px;">
                            <div style="text-align: center; border-bottom: 1px solid #1e293b; padding-bottom: 20px; margin-bottom: 20px;">
                                <h1 style="color: #f43f5e; margin: 0; font-size: 32px; font-weight: 900; letter-spacing: -1px;">LAST DANCE</h1>
                                <p style="color: #cbd5e1; font-style: italic; margin: 4px 0 0 0; font-size: 14px;">"One Last Night. One Last Dance."</p>
                            </div>
                            <div style="color: #e2e8f0; font-size: 15px; line-height: 1.6;">
                                <p>Hello <strong>${ticketOrder.buyerName}</strong>,</p>
                                <p>Your entry ticket purchase of <strong>${ticketOrder.quantity} Ticket(s)</strong> (KES ${ticketOrder.totalAmountKES}) is confirmed!</p>
                                <p><strong>M-Pesa Receipt:</strong> ${ticketOrder.mpesaReceiptNumber}</p>

                                ${htmlTickets}
                            </div>
                            <div style="text-align: center; border-top: 1px solid #1e293b; padding-top: 20px; margin-top: 30px; font-size: 12px; color: #64748b;">
                                <p>Event Date: October 26th | Graduation Eve Send-Off</p>
                                <p>© NutriPay Last Dance Event Engine</p>
                            </div>
                        </div>
                    </body>
                    </html>
                `;

                await sendMail({
                    to: ticketOrder.buyerEmail,
                    subject: `🎟️ Your Digital Ticket(s) for Last Dance (${ticketOrder.ticketCodes?.length || ticketOrder.quantity})`,
                    html: emailHtml
                });
                ticketOrder.emailSent = true;
                await ticketOrder.save();
                console.log(`[LastDance] Sent ticket email to ${ticketOrder.buyerEmail}`);
            } catch (mailErr) {
                console.error('[LastDance] Ticket email send error:', mailErr.message);
            }

            return res.json({ ResponseCode: '0', ResponseDesc: 'Success' });
        }

        // B. Check if it's a Vote Transaction
        const voteTx = await VoteTransaction.findOne({ checkoutRequestID: { $in: lookupKeys } });
        if (voteTx) {
            if (!success) {
                voteTx.status = 'failed';
                await voteTx.save();
                console.log(`[LastDance] Vote transaction ${voteTx._id} payment failed.`);
                return res.json({ ResponseCode: '0', ResponseDesc: 'Success' });
            }

            if (voteTx.status === 'completed') {
                return res.json({ ResponseCode: '0', ResponseDesc: 'Already processed' });
            }

            voteTx.status = 'completed';
            voteTx.mpesaReceiptNumber = mpesaReceiptNumber || `VOTE-${Date.now()}`;
            await voteTx.save();

            // Increment candidate vote count atomically
            const candidate = await Candidate.findByIdAndUpdate(
                voteTx.candidate,
                { $inc: { voteCount: voteTx.votesCount } },
                { new: true }
            );

            console.log(`[LastDance] Added ${voteTx.votesCount} votes to candidate ${candidate.name}. New Total: ${candidate.voteCount}`);

            // Broadcast real-time WebSocket event across all clients
            try {
                if (global.io) {
                    global.io.emit('last_dance:vote_updated', {
                        candidateId: candidate._id,
                        candidateName: candidate.name,
                        category: candidate.category,
                        newVoteCount: candidate.voteCount,
                        votesAdded: voteTx.votesCount,
                        packageLabel: voteTx.packageLabel,
                        timestamp: new Date()
                    });

                    // Emit live activity ticker event
                    global.io.emit('last_dance:activity_feed', {
                        message: `🔥 +${voteTx.votesCount} votes cast for ${candidate.name} (${candidate.category})!`,
                        candidateName: candidate.name,
                        votesCount: voteTx.votesCount,
                        timestamp: new Date()
                    });
                }
            } catch (wsErr) {
                console.warn('[LastDance] WebSocket broadcast error:', wsErr.message);
            }

            return res.json({ ResponseCode: '0', ResponseDesc: 'Success' });
        }

        return res.json({ ResponseCode: '0', ResponseDesc: 'Unmatched transaction' });
    } catch (err) {
        console.error('[LastDance] handlePaymentCallback error:', err);
        return res.json({ ResponseCode: '0', ResponseDesc: 'Error handled' });
    }
};

// 9. Admin Endpoints: Fetch All Candidates (Pending & Approved) + Registration Breakdown Stats
exports.adminGetCandidates = async (req, res) => {
    try {
        const candidates = await Candidate.find().sort({ createdAt: -1 });
        const pendingCount = candidates.filter(c => !c.isApproved).length;
        const approvedCount = candidates.filter(c => c.isApproved).length;

        // Group counts by category
        const categoryCounts = {};
        candidates.forEach(c => {
            if (!categoryCounts[c.category]) {
                categoryCounts[c.category] = { total: 0, approved: 0, pending: 0 };
            }
            categoryCounts[c.category].total += 1;
            if (c.isApproved) categoryCounts[c.category].approved += 1;
            else categoryCounts[c.category].pending += 1;
        });

        const totalTicketsSold = await TicketPurchase.aggregate([
            { $match: { status: 'completed' } },
            { $group: { _id: null, totalQty: { $sum: '$quantity' }, totalRevenue: { $sum: '$totalAmountKES' } } }
        ]);

        const totalVotesCast = await VoteTransaction.aggregate([
            { $match: { status: 'completed' } },
            { $group: { _id: null, totalVotes: { $sum: '$votesCount' }, totalRevenue: { $sum: '$amountKES' } } }
        ]);

        res.json({
            success: true,
            candidates,
            stats: {
                totalCandidates: candidates.length,
                pendingCount,
                approvedCount,
                categoryCounts,
                ticketStats: totalTicketsSold[0] || { totalQty: 0, totalRevenue: 0 },
                voteStats: totalVotesCast[0] || { totalVotes: 0, totalRevenue: 0 }
            }
        });
    } catch (err) {
        console.error('[LastDance] adminGetCandidates error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

// 10. Admin Approve / Reject Candidate
exports.adminApproveCandidate = async (req, res) => {
    try {
        const { candidateId } = req.params;
        const { approve } = req.body; // boolean

        const candidate = await Candidate.findById(candidateId);
        if (!candidate) {
            return res.status(404).json({ success: false, message: 'Candidate not found.' });
        }

        candidate.isApproved = typeof approve === 'boolean' ? approve : true;
        await candidate.save();

        res.json({
            success: true,
            candidate,
            message: `Candidate ${candidate.name} ${candidate.isApproved ? 'Approved' : 'Moved to Pending'}.`
        });
    } catch (err) {
        console.error('[LastDance] adminApproveCandidate error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

// 11. Admin Edit Candidate / Reassign Category
exports.adminUpdateCandidate = async (req, res) => {
    try {
        const { candidateId } = req.params;
        const { name, photoUrl, oneLiner, pitch, category, voteCount } = req.body;

        const candidate = await Candidate.findById(candidateId);
        if (!candidate) {
            return res.status(404).json({ success: false, message: 'Candidate not found.' });
        }

        if (name) candidate.name = name;
        if (photoUrl) candidate.photoUrl = photoUrl;
        if (oneLiner) candidate.oneLiner = oneLiner;
        if (pitch) candidate.pitch = pitch;
        if (category) candidate.category = category;
        if (typeof voteCount === 'number' && voteCount >= 0) candidate.voteCount = voteCount;

        await candidate.save();
        res.json({ success: true, candidate, message: 'Candidate updated successfully.' });
    } catch (err) {
        console.error('[LastDance] adminUpdateCandidate error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

// 12. Admin Delete Candidate
exports.adminDeleteCandidate = async (req, res) => {
    try {
        const { candidateId } = req.params;
        await Candidate.findByIdAndDelete(candidateId);
        res.json({ success: true, message: 'Candidate deleted successfully.' });
    } catch (err) {
        console.error('[LastDance] adminDeleteCandidate error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};
