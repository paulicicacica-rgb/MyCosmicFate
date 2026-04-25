module.exports = async (req, res) => {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  console.log('URL:', url);
  console.log('Token first 15:', token?.slice(0, 15));
  console.log('Token length:', token?.length);

  try {
    const pingRes = await fetch(`${url}/ping`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const pingText = await pingRes.text();
    console.log('Ping status:', pingRes.status);
    console.log('Ping response:', pingText);
    res.json({ status: pingRes.status, response: pingText, tokenLength: token?.length, url });
  } catch (err) {
    res.json({ error: err.message });
  }
};
