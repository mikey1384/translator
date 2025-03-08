import { Buffer } from 'buffer';
import { Theme } from '~/constants/css';
import { Card } from '~/types';
import { userIdRef } from '~/constants/state';
import { socket } from '~/constants/sockets/api';

import {
  returnCardBurnXP,
  CHAT_ID_BASE_NUMBER,
  returnMaxRewards,
  MOD_LEVEL,
  TEACHER_LEVEL,
  ADMIN_USER_ID
} from '~/constants/defaultValues';

import axios from 'axios';
import URL from '~/constants/URL';

export function calculateTotalBurnValue(cards: Card[]) {
  let totalBv = 0;
  for (const card of cards) {
    if (card.level && card.quality) {
      totalBv += returnCardBurnXP({
        cardLevel: card.level,
        cardQuality: card.quality
      });
    }
  }
  return totalBv;
}

export async function checkMicrophoneAccess() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch (error) {
    console.error('Microphone access not granted:', error);
    return false;
  }
}

export function checkScrollIsAtTheBottom({
  content,
  container
}: {
  content: HTMLElement;
  container: HTMLElement;
}) {
  return content.offsetHeight <= container.offsetHeight + container.scrollTop;
}

export function determineUserCanRewardThis({
  canReward,
  userLevel,
  recommendations = [],
  uploader,
  userId
}: {
  canReward: boolean;
  userLevel: number;
  recommendations?: any[];
  uploader?: { id: number };
  userId: number;
}) {
  if (!userId) return false;
  let studentsCanReward = false;
  let moderatorCanReward = canReward;
  if (
    userLevel >= MOD_LEVEL &&
    !isSupermod(userLevel) &&
    uploader?.id === ADMIN_USER_ID
  ) {
    moderatorCanReward = false;
  }
  if (!isSupermod(userLevel)) {
    for (const recommendation of recommendations) {
      if (isSupermod(recommendation.level) && !recommendation.rewardDisabled) {
        studentsCanReward = true;
        moderatorCanReward = true;
        break;
      }
    }
  }
  return (studentsCanReward || moderatorCanReward) && userId !== uploader?.id;
}

export function determineXpButtonDisabled({
  rewardLevel,
  rewards,
  myId,
  xpRewardInterfaceShown
}: {
  rewardLevel: number;
  rewards: any[];
  myId: number;
  xpRewardInterfaceShown: boolean;
}) {
  const maxRewards = returnMaxRewards({ rewardLevel });
  if (xpRewardInterfaceShown) return 'Reward';
  const numTotalRewards = rewards.reduce(
    (prev, reward) => prev + reward.rewardAmount,
    0
  );
  if (numTotalRewards >= maxRewards) {
    return `${maxRewards}/${maxRewards} Twinkles`;
  }
  const numPrevRewards = rewards.reduce((prev, reward) => {
    if (reward.rewarderId === myId) {
      return prev + reward.rewardAmount;
    }
    return prev;
  }, 0);
  const maxRewardables = Math.min(Math.ceil(maxRewards / 2), 3);
  if (numPrevRewards >= maxRewardables) {
    return `${maxRewardables}/${maxRewardables} Rewarded`;
  }
  return false;
}

export function returnImageFileFromUrl({
  imageUrl,
  fileName = 'thumb.png'
}: {
  imageUrl: string;
  fileName?: string;
}) {
  const dataUri = imageUrl.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(dataUri, 'base64');
  const file = new File([buffer], fileName);
  return file;
}

export function getAge(dateString: string) {
  const birthDate = new Date(dateString);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

export function getSectionFromPathname(pathname: string) {
  const result = pathname?.split('/')[1];
  return {
    section: result === '' ? 'home' : result,
    isSubsection: !!pathname?.split(result)[1]
  };
}

export function isPhone(navigator: Navigator) {
  return (
    /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    ) && !/iPad|Macintosh/i.test(navigator.userAgent)
  );
}

export function isTablet(navigator: Navigator) {
  return (
    /iPad|Macintosh/i.test(navigator.userAgent) &&
    'ontouchend' in document &&
    !/Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    )
  );
}

export function isMobile(navigator: Navigator) {
  return (
    /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    ) ||
    (/iPad|Macintosh/i.test(navigator.userAgent) && 'ontouchend' in document)
  );
}

export function isSupermod(level = 0) {
  return level >= TEACHER_LEVEL;
}

export function last(array: any[]) {
  return array[array.length - 1];
}

/**
 * @param callback
 * @param delay
 * @returns
 */
export function throttle<T extends (...args: any[]) => any>(
  callback: T,
  delay: number = 100
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  let timeoutId: number | null = null;
  let lastArgs: Parameters<T> | null = null;

  return function (...args: Parameters<T>) {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;

    // Clear any existing timeout
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }

    if (timeSinceLastCall >= delay) {
      lastCall = now;
      callback(...args);
    } else {
      lastArgs = args;
      timeoutId = window.setTimeout(() => {
        if (lastArgs) {
          lastCall = Date.now();
          callback(...lastArgs);
          lastArgs = null;
          timeoutId = null;
        }
      }, delay - timeSinceLastCall);
    }
  };
}

/**
 * @param callback
 * @param delay
 * @returns
 */
export function debounce<T extends (...args: any[]) => any>(
  callback: T,
  delay: number = 100
): (...args: Parameters<T>) => void {
  let timeoutId: number | null = null;

  return function (...args: Parameters<T>) {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }

    timeoutId = window.setTimeout(() => {
      callback(...args);
      timeoutId = null;
    }, delay);
  };
}

export function logForAdmin({
  message,
  showPopup = false
}: {
  message: string;
  showPopup?: boolean;
}) {
  if (userIdRef.current === ADMIN_USER_ID) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
    if (showPopup) {
      socket.emit('new_log_for_admin', message);
    }
  }
}

export function objectify(array: any[] = [], id: any = 'id') {
  const result: any = {};
  for (const elem of array || []) {
    result[elem[id]] = elem;
  }
  return result;
}

export function parseChannelPath(pathId: string | number) {
  return Number(pathId) - Number(CHAT_ID_BASE_NUMBER);
}

export function returnTheme(color?: string) {
  return Theme(color || 'logoBlue');
}

export function scrollElementToCenter(element: any, adjustment = -50): void {
  if (!element) return;
  let offsetTop = 0;
  const body: { scrollTop: number; clientHeight: number } = document
    ? ((document.scrollingElement || document.documentElement) as {
        scrollTop: number;
        clientHeight: number;
      })
    : { scrollTop: 0, clientHeight: 0 };
  addAllOffsetTop(element);
  body.scrollTop =
    offsetTop + adjustment - (body.clientHeight - element.clientHeight) / 2;

  const appElement = document.getElementById('App') as HTMLElement;
  if (appElement) {
    appElement.scrollTop =
      offsetTop +
      adjustment -
      (appElement.clientHeight - element.clientHeight) / 2;
  }

  function addAllOffsetTop(element: HTMLElement): void {
    offsetTop += element.offsetTop;
    if (element.offsetParent) {
      addAllOffsetTop(element.offsetParent as HTMLElement);
    }
  }
}

export function scrollElementTo({
  element,
  amount
}: {
  element: HTMLElement | null;
  amount: number;
}): void {
  if (!element) return;
  let offsetTop = 0;
  const body: { scrollTop: number; clientHeight: number } = document
    ? ((document.scrollingElement || document.documentElement) as {
        scrollTop: number;
        clientHeight: number;
      })
    : { scrollTop: 0, clientHeight: 0 };
  addAllOffsetTop(element);
  body.scrollTop = offsetTop + amount - 350;
  const appElement = document.getElementById('App') as HTMLElement;
  if (appElement) {
    appElement.scrollTop = offsetTop + amount - 350;
  }
  function addAllOffsetTop(element: HTMLElement): void {
    offsetTop += element.offsetTop;
    if (element.offsetParent) {
      addAllOffsetTop(element.offsetParent as HTMLElement);
    }
  }
}

export function textIsOverflown(element: HTMLElement) {
  return (
    element.scrollHeight > element.clientHeight ||
    element.scrollWidth > element.clientWidth
  );
}

export async function attemptUpload({
  fileName,
  selectedFile,
  onUploadProgress,
  path,
  context = 'feed',
  auth
}: {
  fileName: string;
  selectedFile: File;
  onUploadProgress: (progressEvent: any) => void;
  path: string;
  context?: string;
  auth: () => any;
}): Promise<string | void> {
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 2000;
  const CHUNK_SIZE = 5 * 1024 * 1024;

  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  logForAdmin({
    message: `Attempting to upload file ${fileName}`
  });
  const { uploadId, urls, key } = await initiateUpload();
  logForAdmin({
    message: `Fetched signed S3 URLs for ${fileName}`
  });
  const parts = [];
  let start = 0;

  // Upload parts sequentially
  for (let partNumber = 0; partNumber < urls.length; partNumber++) {
    const end = Math.min(start + CHUNK_SIZE, selectedFile.size);
    const chunk = selectedFile.slice(start, end);
    logForAdmin({
      message: `Uploading part ${partNumber + 1} of ${
        urls.length
      } for ${fileName}`
    });
    const part = await uploadPart(urls[partNumber], chunk, partNumber);
    logForAdmin({
      message: `Part ${partNumber + 1} of ${
        urls.length
      } for ${fileName} successfully uploaded`
    });
    parts.push(part);
    start = end;
  }

  await completeUpload(uploadId, key, parts);
  const result = key.split('.com')?.[1] || `/${key}`;
  logForAdmin({
    message: `Upload completed for ${fileName}. Returning key: ${result}`
  });
  return result;

  async function initiateUpload(
    attempt = 1
  ): Promise<{ uploadId: string; urls: string[]; key: string }> {
    try {
      logForAdmin({
        message: `Getting signed S3 URL for ${fileName}`
      });
      const { data } = await axios.get(
        `${URL}/content/sign-s3?fileSize=${
          selectedFile.size
        }&fileName=${encodeURIComponent(
          fileName
        )}&path=${path}&context=${context}`,
        auth()
      );
      logForAdmin({
        message: `Got signed S3 URL for ${fileName}`
      });
      return data;
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        logForAdmin({
          message: `Retrying initiation, attempt ${attempt + 1}`
        });
        await sleep(RETRY_DELAY);
        return initiateUpload(attempt + 1);
      }
      throw error;
    }
  }

  async function uploadPart(
    url: string,
    chunk: Blob,
    partNumber: number,
    attempt = 1
  ): Promise<{ ETag: string; PartNumber: number }> {
    try {
      logForAdmin({
        message: `Making PUT request for part ${partNumber + 1} of ${
          urls.length
        } for ${fileName}`
      });
      const response = await axios.put(url, chunk, {
        timeout: 30000 * attempt,
        headers: {
          'Content-Type': selectedFile.type,
          ...(context === 'interactive' || context === 'mission'
            ? {
                'Content-Disposition': `attachment; filename="${fileName}"`
              }
            : {})
        },
        onUploadProgress: (progressEvent) => {
          const totalProgress =
            (partNumber * CHUNK_SIZE + progressEvent.loaded) /
            selectedFile.size;
          onUploadProgress({
            loaded: totalProgress * selectedFile.size,
            total: selectedFile.size
          });
        }
      });
      logForAdmin({
        message: `PUT request for part ${partNumber + 1} of ${
          urls.length
        } for ${fileName} completed`
      });

      const etag = response.headers?.etag || response.headers?.ETag;
      if (!etag) {
        throw new Error(
          `Missing ETag in response for part ${partNumber + 1}. Status: ${
            response.status
          }`
        );
      }

      return {
        ETag: etag.replace(/['"]/g, ''),
        PartNumber: partNumber + 1
      };
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        logForAdmin({
          message: `Retrying part ${partNumber + 1}, attempt ${attempt + 1}`
        });
        await sleep(RETRY_DELAY);
        return uploadPart(url, chunk, partNumber, attempt + 1);
      }
      throw error;
    }
  }

  async function completeUpload(
    uploadId: string,
    key: string,
    parts: any[],
    attempt = 1
  ) {
    try {
      logForAdmin({
        message: `Completing upload for ${fileName}`
      });
      await axios.post(
        `${URL}/content/complete-upload`,
        { uploadId, key, parts },
        auth()
      );
      logForAdmin({
        message: `Completed upload for ${fileName}`
      });
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        logForAdmin({
          message: `Retrying completion, attempt ${attempt + 1}`
        });
        await sleep(RETRY_DELAY);
        return completeUpload(uploadId, key, parts, attempt + 1);
      }
      throw error;
    }
  }
}
