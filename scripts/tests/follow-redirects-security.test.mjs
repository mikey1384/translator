import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import axios from 'axios';
import followRedirects from 'follow-redirects';

// Synthetic values only; all requests stay on loopback.
const credentials = {
  Authorization: 'test-authorization',
  'Proxy-Authorization': 'test-proxy-authorization',
  Cookie: 'test-cookie',
  'X-Api^Key': 'test-custom-key',
  'X-Token|Secret': 'test-custom-token',
};
const sensitiveHeaders = ['X-Api^Key', 'X-Token|Secret'];

async function listen(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => {
    server.closeAllConnections();
    return new Promise(resolve => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function redirectFixture(t) {
  const echo = (req, res) => {
    req.resume();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.headers));
  };
  const destination = await listen(t, echo);
  const source = await listen(t, (req, res) => {
    if (req.url === '/same' || req.url === '/cross') {
      req.resume();
      res.writeHead(302, {
        Location: req.url === '/same' ? '/target' : destination,
      });
      res.end();
    } else {
      echo(req, res);
    }
  });
  return { source, destination };
}

async function requestHeaders(url, options) {
  return new Promise((resolve, reject) => {
    const request = followRedirects.http.get(url, options, async response => {
      try {
        let body = '';
        for await (const chunk of response) body += chunk;
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
    request.setTimeout(5_000, () => request.destroy(new Error('Test timeout')));
  });
}

for (const arrayHeaders of [false, true]) {
  test(`redirects protect credentials with ${arrayHeaders ? 'array' : 'object'} headers`, async t => {
    const { source, destination } = await redirectFixture(t);
    const headers = {
      ...credentials,
      Host: new URL(source).host,
      'X-Token': 'public-token-label',
      Secret: 'public-label',
    };
    const options = () => ({
      headers: arrayHeaders ? Object.entries(headers).flat() : { ...headers },
      sensitiveHeaders,
    });

    const same = await requestHeaders(`${source}/same`, options());
    for (const [name, value] of Object.entries(credentials)) {
      assert.equal(same[name.toLowerCase()], value);
    }

    const cross = await requestHeaders(`${source}/cross`, options());
    for (const name of Object.keys(credentials)) {
      assert.equal(cross[name.toLowerCase()], undefined, `${name} leaked`);
    }
    assert.equal(cross.host, new URL(destination).host);
    // A literal pipe in a sensitive name must not strip unrelated names.
    assert.equal(cross['x-token'], 'public-token-label');
    assert.equal(cross.secret, 'public-label');
  });
}

test('Axios preserves same-origin auth and strips cross-origin credentials', async t => {
  const { source, destination } = await redirectFixture(t);
  const options = {
    headers: credentials,
    sensitiveHeaders,
    proxy: false,
    timeout: 5_000,
  };
  const same = await axios.get(`${source}/same`, options);
  assert.equal(same.data.authorization, credentials.Authorization);
  assert.equal(same.data.cookie, credentials.Cookie);

  const cross = await axios.get(`${source}/cross`, options);
  for (const name of Object.keys(credentials)) {
    assert.equal(cross.data[name.toLowerCase()], undefined, `${name} leaked`);
  }
  assert.equal(cross.data.host, new URL(destination).host);
});
