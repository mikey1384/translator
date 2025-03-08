import { SELECTED_LANGUAGE } from '~/constants/defaultValues';

export function timeSince(dateText: string | number) {
  const date = new Date(Number(dateText) * 1000);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  let interval: string | number = Math.floor(seconds / 31536000);
  let s = 's';
  if (interval >= 1) {
    if (interval === 1 && SELECTED_LANGUAGE === 'en') {
      interval = 'a';
      s = '';
    }
    if (SELECTED_LANGUAGE === 'kr') {
      return `${interval}년 전`;
    }
    return interval + ' year' + s + ' ago';
  }
  interval = Math.floor(seconds / 2592000);
  if (interval >= 1) {
    if (interval === 1 && SELECTED_LANGUAGE === 'en') {
      interval = 'a';
      s = '';
    }
    if (SELECTED_LANGUAGE === 'kr') {
      return `${interval}달 전`;
    }
    return interval + ' month' + s + ' ago';
  }
  interval = Math.floor(seconds / 86400);
  if (interval >= 1) {
    if (interval === 1 && SELECTED_LANGUAGE === 'en') {
      interval = 'a';
      s = '';
    }
    if (SELECTED_LANGUAGE === 'kr') {
      return `${interval}일 전`;
    }
    return interval + ' day' + s + ' ago';
  }
  interval = Math.floor(seconds / 3600);
  if (interval >= 1) {
    if (interval === 1 && SELECTED_LANGUAGE === 'en') {
      interval = 'an';
      s = '';
    }
    if (SELECTED_LANGUAGE === 'kr') {
      return `${interval}시간 전`;
    }
    return interval + ' hour' + s + ' ago';
  }
  interval = Math.floor(seconds / 60);
  if (interval >= 1) {
    if (interval === 1 && SELECTED_LANGUAGE === 'en') {
      interval = 'a';
      s = '';
    }
    if (SELECTED_LANGUAGE === 'kr') {
      return `${interval}분 전`;
    }
    return interval + ' minute' + s + ' ago';
  }
  s = Math.floor(seconds) > 1 ? 's' : '';
  if (seconds <= 0) {
    if (SELECTED_LANGUAGE === 'kr') {
      return '방금';
    }
    return 'just now';
  }
  if (SELECTED_LANGUAGE === 'kr') {
    return `${seconds}초 전`;
  }
  return Math.floor(seconds) + ' second' + s + ' ago';
}

export function formatDate(dateText: string | number) {
  const date = new Date(Number(dateText) * 1000);
  return date.toLocaleString(SELECTED_LANGUAGE === 'kr' ? 'ko-KR' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
