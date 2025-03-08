import { userQuery } from './';
import axios from 'axios';
import * as cheerio from 'cheerio';

export async function searchContents({
  exact,
  match,
  like,
  poolQuery
}: {
  exact: { query: string; params: string };
  match: { query: string; params: string };
  like: { query: string; params: string };
  poolQuery: (query: string, params: string) => Promise<any[]>;
}) {
  const exactQueryResults = await poolQuery(exact.query, exact.params);
  let matchQueryResults = await poolQuery(match.query, match.params);
  let likeQueryResults = await poolQuery(like.query, like.params);
  const exactQueryIds = exactQueryResults.map((result) => result.id);
  matchQueryResults = matchQueryResults.filter(
    (result) => !exactQueryIds.includes(result.id)
  );
  likeQueryResults = likeQueryResults.filter(
    (result) => !exactQueryIds.includes(result.id)
  );
  const matchQueryIds = matchQueryResults.map((result) => result.id);
  const matchQueryObjects = matchQueryResults.reduce((prev, elem) => {
    return { ...prev, [elem.id]: elem };
  }, {});
  const dupe: any[] = [];
  const filteredLikeQueryResults = likeQueryResults.reduce((prev, elem) => {
    if (!matchQueryIds.includes(elem.id)) {
      return prev.concat(elem);
    }
    dupe.push(elem.id);
    return prev;
  }, []);
  const filteredMatchQueryResults = [
    ...dupe,
    ...matchQueryIds.filter((id) => !dupe.includes(id))
  ].map((elem) => matchQueryObjects[elem]);
  const finalSearchResultsRaw = exactQueryResults.concat(
    filteredLikeQueryResults.concat(filteredMatchQueryResults)
  );
  const finalSearchResults = [];
  for (const result of finalSearchResultsRaw) {
    if (result.isClosedBy) {
      result.isClosedBy = await userQuery({ userId: result.isClosedBy });
    }
    finalSearchResults.push(result);
  }
  return Promise.resolve(finalSearchResults);
}

export async function getThumbImageFromEmbedApi({ url }: { url: string }) {
  try {
    const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;

    let response;
    try {
      response = await axios.get(normalizedUrl, {
        headers: {
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });
    } catch {
      response = await axios.get(normalizedUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        timeout: 10000,
        maxRedirects: 5
      });
    }

    const html = response.data;
    const $ = cheerio.load(html);

    let title =
      $('meta[property="og:title"]').attr('content') ||
      $('meta[name="twitter:title"]').attr('content') ||
      $('title').text()?.trim() ||
      $('img[alt]').first().attr('alt') ||
      '';

    let description =
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="twitter:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      '';

    const imageUrl =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      $('link[rel="image_src"]').attr('href') ||
      $('img').first().attr('src') ||
      '';

    const urlObj = new URL(normalizedUrl);
    const hostname = urlObj.hostname.replace('www.', '');
    const pathSegments = urlObj.pathname.split('/').filter(Boolean);

    if (!title) {
      title = pathSegments.length
        ? pathSegments[pathSegments.length - 1]
            .replace(/[-_]/g, ' ')
            .replace(/\.\w+$/, '')
            .split(' ')
            .map(
              (word) =>
                word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
            )
            .join(' ')
        : hostname;
    }

    if (!description) {
      const paragraphs = $('p')
        .map((_, el) => $(el).text()?.trim())
        .get();
      description = paragraphs.find((p) => p.length > 0) || '';
      if (description.length > 200) {
        description = description.substring(0, 197) + '...';
      }
    }

    const site = $('meta[property="og:site_name"]').attr('content') || hostname;

    return Promise.resolve({
      image: { url: imageUrl },
      title,
      description,
      site,
      timeStamp: Math.floor(Date.now() / 1000)
    });
  } catch (error) {
    try {
      const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
      const hostname = urlObj.hostname.replace('www.', '');
      const pathSegments = urlObj.pathname.split('/').filter(Boolean);

      return {
        image: { url: '' },
        title: pathSegments.length
          ? `${pathSegments[pathSegments.length - 1].replace(/[-_]/g, ' ')} - ${hostname}`
          : hostname,
        description: pathSegments.length ? `/${pathSegments.join('/')}` : '',
        site: hostname,
        timeStamp: Math.floor(Date.now() / 1000)
      };
    } catch {
      return {
        image: { url: '' },
        title: url,
        description: '',
        site: 'unknown',
        timeStamp: Math.floor(Date.now() / 1000)
      };
    }
  }
}
