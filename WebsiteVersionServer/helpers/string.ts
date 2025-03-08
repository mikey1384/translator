import { encode, decode } from 'gpt-3-encoder';

/* eslint-disable no-useless-escape */

export const isValidEmail = (email = '') => {
  const regex = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,3}/g;
  return regex.test(email);
};

export const isValidUsername = (username: string) => {
  const pattern = new RegExp(/^(?!.*___.*)[a-zA-Z0-9_]+$/);
  return (
    !!username &&
    username.length < 20 &&
    username.length > 2 &&
    pattern.test(username)
  );
};

export const isValidUrl = (url = '') => {
  const regex =
    /^(http[s]?:\/\/(www\.)?|ftp:\/\/(www\.)?|www\.){1}([0-9A-Za-z-\.@:%_\+~#=]+)+((\.[a-zA-Z]{2,3})+)(\/(.)*)?(\?(.)*)?/g;
  if (!url.includes('://') && !url.includes('www.')) {
    url = 'www.' + url;
  }
  return regex.test(url);
};

export const isValidYoutubeChannelUrl = (url = '') => {
  const regex =
    /^(http[s]?:\/\/(www\.)?|ftp:\/\/(www\.)?|www\.){1}([0-9A-Za-z-\.@:%_\+~#=]+)+((\.[a-zA-Z]{2,3})+)(\/(.)*)?(\?(.)*)?/g;
  const trim = url.split('youtube.com/')[1];
  if (!url.includes('://') && !url.includes('www.')) {
    url = 'www.' + url;
  }
  return regex.test(url) && typeof trim !== 'undefined';
};

export const fetchedVideoCodeFromURL = (url = '') => {
  let videoCode = '';
  if (typeof url.split('v=')[1] !== 'undefined') {
    const trimmedUrl = url.split('v=')[1].split('#')[0];
    videoCode = trimmedUrl.split('&')[0];
  } else if (typeof url.split('youtu.be/')[1] !== 'undefined') {
    const trimmedUrl = url.split('youtu.be/')[1].split('#')[0];
    videoCode = trimmedUrl.split('&')[0].split('?')[0];
  }
  return videoCode;
};

export const processedURL = (url = '') => {
  if (!url.includes('://')) {
    url = 'http://' + url;
  }
  return url;
};

export const trimWhiteSpaces = (text = '') => {
  return text.trim();
};

export const capitalize = (string: string) => {
  return string.charAt(0).toUpperCase() + string.slice(1);
};

export const isImageFile = (fileName: string) => {
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  return imageExtensions.includes(extension);
};

export const countTokens = (text: string) => {
  const tokens = encode(text);
  return tokens.length;
};

export const stringIsEmpty = (string?: string) => {
  const evalString = string || '';
  if (evalString && typeof evalString !== 'string') return true;
  return evalString.length === 0 || !evalString.trim();
};

export const trimTokens = (text: string, maxLength: number) => {
  const tokens = encode(text);
  if (tokens.length <= maxLength) {
    return text;
  }

  let trimmedTokens = tokens.slice(0, maxLength);
  let trimmedText = decode(trimmedTokens);

  while (countTokens(trimmedText) > maxLength) {
    trimmedTokens = trimmedTokens.slice(0, -1);
    trimmedText = decode(trimmedTokens);
  }

  return trimmedText;
};

export const truncateTopic = (topic: string) => {
  // Remove quotes if enclosed in them
  if (topic.startsWith('"') && topic.endsWith('"')) {
    topic = topic.slice(1, -1);
  } else if (topic.startsWith("'") && topic.endsWith("'")) {
    topic = topic.slice(1, -1);
  }
  if (topic.endsWith('.')) {
    topic = topic.slice(0, -1);
  }
  // Truncate if over 100 characters
  if (topic.length > 100) {
    topic = topic.slice(0, 100) + '...';
  }

  return topic;
};

/* eslint-enable no-useless-escape */
