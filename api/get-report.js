module.exports = async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  const url = `${process.env.UPSTASH_REDIS_REST_URL}/get/report:${id}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
  });

  const data = await response.json();
  if (!data.result) return res.status(404).json({ error: 'Report not found' });

  res.json(JSON.parse(data.result));
};
