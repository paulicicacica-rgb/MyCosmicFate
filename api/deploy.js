module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  
  const { secret, files } = req.body;
  
  // Simple auth check
  if (secret !== process.env.DEPLOY_SECRET) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  const token = process.env.GITHUB_TOKEN;
  const repo = 'paulicicacica-rgb/MyCosmicFate';
  const branch = 'main';
  const results = [];

  for (const file of files) {
    const { path, content } = file;
    
    // Get current SHA if file exists
    let sha;
    try {
      const getRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        }
      });
      if (getRes.ok) {
        const data = await getRes.json();
        sha = data.sha;
      }
    } catch(e) {}

    // Push file
    const body = {
      message: `Auto-deploy: ${path}`,
      content: Buffer.from(content).toString('base64'),
      branch,
    };
    if (sha) body.sha = sha;

    const pushRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const pushData = await pushRes.json();
    results.push({ path, ok: pushRes.ok, status: pushRes.status });
    console.log(`${path}: ${pushRes.ok ? 'OK' : 'FAILED'} ${pushRes.status}`);
  }

  res.json({ results });
};
