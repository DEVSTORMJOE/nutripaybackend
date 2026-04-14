const PublicSponsor = require('../models/PublicSponsor');

const getActiveSponsors = async (req, res) => {
  try {
    const sponsors = await PublicSponsor.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 });
    res.json(sponsors);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

const getAllSponsors = async (req, res) => {
  try {
    const sponsors = await PublicSponsor.find({}).sort({ sortOrder: 1, createdAt: -1 });
    res.json(sponsors);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

const createSponsor = async (req, res) => {
  try {
    const { name, logoUrl, href, sortOrder, isActive } = req.body;
    const newSponsor = await PublicSponsor.create({ name, logoUrl, href, sortOrder, isActive });
    res.status(201).json(newSponsor);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

const updateSponsor = async (req, res) => {
  try {
    const sponsor = await PublicSponsor.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!sponsor) return res.status(404).json({ message: 'Sponsor not found' });
    res.json(sponsor);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

const deleteSponsor = async (req, res) => {
  try {
    const sponsor = await PublicSponsor.findByIdAndDelete(req.params.id);
    if (!sponsor) return res.status(404).json({ message: 'Sponsor not found' });
    res.json({ message: 'Sponsor deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

module.exports = {
  getActiveSponsors,
  getAllSponsors,
  createSponsor,
  updateSponsor,
  deleteSponsor
};
