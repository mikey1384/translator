import React, {
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState
} from 'react';
import UsernameText from '~/components/Texts/UsernameText';
import { addEvent, removeEvent } from '../listenerHelpers';
import { stringIsEmpty, addCommasToNumber } from '../stringHelpers';
import {
  useAppContext,
  useKeyContext,
  useContentContext,
  useProfileContext
} from '~/contexts';
export { default as useScrollToBottom } from './useScrollToBottom';
export { default as useInfiniteScroll } from './useInfiniteScroll';
import {
  ADMIN_MANAGEMENT_LEVEL,
  defaultContentState,
  DEFAULT_PROFILE_THEME,
  localStorageKeys,
  wordleGuessReaction,
  wordLevelHash,
  SELECTED_LANGUAGE
} from '~/constants/defaultValues';
import { Color } from '~/constants/css';
import { levels } from '~/constants/userLevels';
import { User, UserLevel } from '~/types';
import { getStoredItem } from '~/helpers/userDataHelpers';
import { scrollPositions } from '~/constants/state';
import { throttle } from '~/helpers';

const allContentState: Record<string, any> = {};
const BodyRef = document.scrollingElement || document.documentElement;

export function useContentState({
  contentType,
  contentId,
  targetKey
}: {
  contentType?: string;
  contentId?: number | string | null;
  targetKey?: string | null;
}) {
  const contentKey =
    (contentType || '') + (contentId || 0) + (targetKey ? `/${targetKey}` : '');
  allContentState[contentKey] = useContentContext((v) => v.state[contentKey]);
  const state = allContentState[contentKey];
  return state ? { ...defaultContentState, ...state } : defaultContentState;
}

export function useInterval(callback: (v?: any) => any, interval: number) {
  const timerRef = useRef<any>(null);
  useEffect(() => {
    timerRef.current = setInterval(callback, interval);
    return function cleanUp() {
      clearInterval(timerRef.current);
    };
  }, [callback, interval]);
}

export function useLazyLoadForImage(selector: string, setClass: string) {
  useEffect(() => {
    const elements = document.querySelectorAll(selector);

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add(setClass);
            observer.unobserve(entry.target);
          }
        });
      });

      elements.forEach((element) => {
        observer.observe(element);
      });

      return () => {
        elements.forEach((element) => {
          observer.unobserve(element);
        });
      };
    }
  }, [selector, setClass]);
}

export function useLazyLoad({
  PanelRef,
  inView,
  onSetPlaceholderHeight,
  onSetIsVisible,
  delay = 1000
}: {
  PanelRef: React.RefObject<any>;
  inView: boolean;
  onSetPlaceholderHeight?: (height: number) => void;
  onSetIsVisible?: (visible: boolean) => void;
  delay?: number;
}) {
  const timerRef = useRef<any>(null);
  const inViewRef = useRef(inView);

  useEffect(() => {
    inViewRef.current = inView;
    if (!inView) {
      timerRef.current = setTimeout(() => {
        onSetIsVisible?.(false);
      }, delay);
    } else {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      onSetIsVisible?.(true);
    }
  }, [inView, delay, onSetIsVisible]);

  useEffect(() => {
    const handleResize = throttle((entries: ResizeObserverEntry[]) => {
      if (entries.length > 0) {
        const clientHeight = entries[0].target.clientHeight;
        onSetPlaceholderHeight?.(clientHeight);
      }
    }, 100);

    const resizeObserver = new ResizeObserver(handleResize);

    if (PanelRef.current) {
      resizeObserver.observe(PanelRef.current);
    }

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [onSetPlaceholderHeight, PanelRef]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);
}

export function useMyState() {
  // Retrieve various user state values from the global app context
  const contextValues = useAppContext((v) => v.user.state.myState);

  // Current user's uid
  const userId = useAppContext((v) => v.user.state.myState.userId);

  // Retrieve the current user's state from 'userObj'
  const myStateFromUserObj = useAppContext(
    (v) => v.user.state.userObj[userId] || {}
  );

  // Key values from the global app context
  const missions = useAppContext((v) => v.user.state.missions);
  const notifications = useAppContext(
    (v) => v.user.state.myState.state?.notifications
  );
  const collectType = useAppContext((v) => v.user.state.myState.collectType);
  const lastChatPath = useAppContext((v) => v.user.state.myState.lastChatPath);
  const hideWatched = useAppContext((v) => v.user.state.myState.hideWatched);
  const searchFilter = useAppContext((v) => v.user.state.myState.searchFilter);
  const wordleStrictMode = useAppContext(
    (v) => v.user.state.myState.wordleStrictMode
  );

  // Other global user context values
  const loaded = useAppContext((v) => v.user.state.loaded);
  const signinModalShown = useAppContext((v) => v.user.state.signinModalShown);

  // Function to retrieve stored items from local storage
  const getStoredItems = (config: { [key: string]: any }) => {
    return Object.keys(config).reduce((acc: { [key: string]: any }, key) => {
      const storedValue = getStoredItem(key, config[key]);
      // Process and normalize specific stored values
      if (key === 'userId') {
        acc[key] = storedValue ? Number(storedValue) : null;
      } else if (
        key === 'level' ||
        key === 'karmaPoints' ||
        key === 'managementLevel'
      ) {
        acc[key] = Number(storedValue);
      } else {
        acc[key] = storedValue;
      }
      return acc;
    }, {});
  };

  // Retrieve stored items from local storage using predefined keys
  const storedItems = getStoredItems(localStorageKeys);
  const result = useMemo(() => {
    return userId
      ? {
          unlockedAchievementIds: [],
          ...contextValues,
          ...myStateFromUserObj,
          notifications,
          collectType,
          hideWatched,
          lastChatPath,
          searchFilter,
          wordleStrictMode,
          missions: {
            ...(myStateFromUserObj?.state?.missions || {}),
            ...missions
          },
          isAdmin: myStateFromUserObj.managementLevel >= ADMIN_MANAGEMENT_LEVEL,
          loggedIn: true
        }
      : {
          loaded,
          unlockedAchievementIds: [],
          missions: {},
          rewardBoostLvl: 0,
          signinModalShown,
          isAdmin: storedItems.managementLevel >= ADMIN_MANAGEMENT_LEVEL,
          ...storedItems,
          profileTheme: storedItems.profileTheme || DEFAULT_PROFILE_THEME
        };
  }, [
    collectType,
    contextValues,
    hideWatched,
    lastChatPath,
    loaded,
    missions,
    myStateFromUserObj,
    notifications,
    searchFilter,
    signinModalShown,
    storedItems,
    userId,
    wordleStrictMode
  ]);

  return result;
}

export function useOutsideClick(ref: any, callback?: () => any) {
  const [insideClicked, setInsideClicked] = useState(false);
  useEffect(() => {
    function upListener(event: any) {
      if (insideClicked) return setInsideClicked(false);
      const refs = Array.isArray(ref) ? ref : [ref];
      if (refs.some((r) => !r.current || r.current.contains(event.target))) {
        return;
      }
      callback?.();
    }
    function downListener(event: any) {
      const refs = Array.isArray(ref) ? ref : [ref];
      if (refs.some((r) => r.current && r.current.contains(event.target))) {
        setInsideClicked(true);
      }
    }
    addEvent(document, 'mousedown', downListener);
    addEvent(document, 'mouseup', upListener);
    return function cleanUp() {
      removeEvent(document, 'mousedown', downListener);
      removeEvent(document, 'mouseup', upListener);
    };
  });
}

export function useOutsideTap(ref: any | any[], callback: () => any) {
  useEffect(() => {
    function downListener(event: any) {
      const refs = Array.isArray(ref) ? ref : [ref];
      if (refs.some((r) => !r.current || r.current.contains(event.target))) {
        return;
      }
      callback();
    }
    addEvent(document, 'scroll', downListener);
    addEvent(document, 'mousedown', downListener);
    return function cleanUp() {
      removeEvent(document, 'scroll', downListener);
      removeEvent(document, 'mousedown', downListener);
    };
  });
}

export function useProfileState(username: string) {
  const state = useProfileContext((v) => v.state) || {};
  const { [username]: userState = {} } = state;
  const {
    notExist = false,
    notables = { feeds: [] },
    subjects = {
      posts: []
    },
    likes = {
      all: [],
      comments: [],
      subjects: [],
      videos: [],
      links: []
    },
    posts = {
      all: [],
      comments: [],
      subjects: [],
      videos: [],
      watched: [],
      links: []
    },
    profileId
  } = userState;
  return { likes, subjects, notables, posts, notExist, profileId };
}

export function useSearch({
  onSearch,
  onEmptyQuery,
  onClear,
  onSetSearchText
}: {
  onSearch: (text: string) => any;
  onEmptyQuery?: () => void;
  onClear?: () => void;
  onSetSearchText: (text: string) => void;
}) {
  const [searching, setSearching] = useState(false);
  const timerRef: React.MutableRefObject<any> = useRef(null);

  function handleSearch(text: string) {
    clearTimeout(timerRef.current);
    onSetSearchText(text);
    onClear?.();
    if (stringIsEmpty(text)) {
      onEmptyQuery?.();
      return setSearching(false);
    }
    setSearching(true);
    timerRef.current = setTimeout(async () => {
      await onSearch(text);
      setSearching(false);
    }, 500);
  }

  return { handleSearch, searching };
}

export function useScrollPosition({
  pathname,
  isMobile
}: {
  pathname: string;
  isMobile: boolean;
}) {
  const pathnameRef = useRef('');

  useEffect(() => {
    if (pathname !== pathnameRef.current) {
      pathnameRef.current = pathname;
      const appElement = document.getElementById('App');
      if (appElement) appElement.scrollTop = scrollPositions[pathname] || 0;
      (BodyRef || {}).scrollTop = scrollPositions[pathname] || 0;
      setTimeout(() => {
        if (appElement) appElement.scrollTop = scrollPositions[pathname] || 0;
        (BodyRef || {}).scrollTop = scrollPositions[pathname] || 0;
      }, 0);
      // prevents bug on mobile devices where tapping stops working after user swipes left to go to previous page
      if (isMobile) {
        setTimeout(() => {
          if (appElement)
            appElement.scrollTop = scrollPositions[pathnameRef.current] || 0;
          (BodyRef || {}).scrollTop = scrollPositions[pathnameRef.current] || 0;
        }, 500);
      }
    }
  }, [pathname, isMobile]);

  useLayoutEffect(() => {
    addEvent(window, 'scroll', handleScroll);
    addEvent(document.getElementById('App'), 'scroll', handleScroll);

    return function cleanUp() {
      removeEvent(window, 'scroll', handleScroll);
      removeEvent(document.getElementById('App'), 'scroll', handleScroll);
    };

    function handleScroll() {
      const appElement = document.getElementById('App');
      const appElementScrollTopPosition = appElement?.scrollTop || 0;
      const position = Math.max(
        appElementScrollTopPosition,
        (BodyRef || {}).scrollTop
      );
      scrollPositions[pathnameRef.current] = position;
    }
  }, []);
}

export function useMyLevel() {
  const {
    achievementPoints = 0,
    canEdit,
    canDelete,
    canReward,
    canPinPlaylists,
    canEditRewardLevel,
    managementLevel = 0
  } = useKeyContext((v) => v.myState);

  const result = useMemo(() => {
    for (let i = levels.length - 1; i >= 0; i--) {
      if (achievementPoints >= levels[i].ap) {
        return {
          ...levels[i],
          canEdit: canEdit || levels[i].canEdit,
          canDelete: canDelete || levels[i].canDelete,
          canReward: canReward || levels[i].canReward,
          canPinPlaylists: canPinPlaylists || levels[i].canPinPlaylists,
          canEditRewardLevel:
            canEditRewardLevel || levels[i].canEditRewardLevel,
          managementLevel: Math.max(managementLevel, levels[i].managementLevel),
          nextLevelAp: i === levels.length - 1 ? null : levels[i + 1].ap
        };
      }
    }
    return {
      ...levels[1],
      canEdit: canEdit || levels[1].canEdit,
      canDelete: canDelete || levels[1].canDelete,
      canReward: canReward || levels[1].canReward,
      canPinPlaylists: canPinPlaylists || levels[1].canPinPlaylists,
      canEditRewardLevel: canEditRewardLevel || levels[1].canEditRewardLevel,
      managementLevel: Math.max(managementLevel, levels[1].managementLevel),
      nextLevelAp: levels[2].ap
    };
  }, [
    achievementPoints,
    canDelete,
    canEdit,
    canEditRewardLevel,
    canPinPlaylists,
    canReward,
    managementLevel
  ]);

  return result;
}

export function useUserLevel(user: User): UserLevel {
  const userObj = useAppContext((v) => v.user.state.userObj);
  const userId = user.id;
  const {
    achievementPoints = user.achievementPoints || 0,
    canEdit,
    canDelete,
    canReward,
    canPinPlaylists,
    canEditRewardLevel,
    managementLevel = 0
  } = userObj[userId] || {};

  const result = useMemo(() => {
    for (let i = levels.length - 1; i >= 0; i--) {
      if (achievementPoints >= levels[i].ap) {
        return {
          ...levels[i],
          canEdit: canEdit || levels[i].canEdit,
          canDelete: canDelete || levels[i].canDelete,
          canReward: canReward || levels[i].canReward,
          canPinPlaylists: canPinPlaylists || levels[i].canPinPlaylists,
          canEditRewardLevel:
            canEditRewardLevel || levels[i].canEditRewardLevel,
          managementLevel: Math.max(managementLevel, levels[i].managementLevel),
          nextLevelAp: i === levels.length - 1 ? null : levels[i + 1].ap
        };
      }
    }
    return {
      ...levels[1],
      canEdit: canEdit || levels[1].canEdit,
      canDelete: canDelete || levels[1].canDelete,
      canReward: canReward || levels[1].canReward,
      canPinPlaylists: canPinPlaylists || levels[1].canPinPlaylists,
      canEditRewardLevel: canEditRewardLevel || levels[1].canEditRewardLevel,
      managementLevel: Math.max(managementLevel, levels[1].managementLevel),
      nextLevelAp: levels[2].ap
    };
  }, [
    achievementPoints,
    canDelete,
    canEdit,
    canEditRewardLevel,
    canPinPlaylists,
    canReward,
    managementLevel
  ]);

  return result;
}

export function useWordleLabels({
  isSolved,
  isStrict,
  numGuesses,
  solution,
  wordLevel,
  xpRewardAmount,
  username,
  userId,
  myId
}: {
  isSolved: boolean;
  isStrict: boolean;
  numGuesses: number;
  solution: string;
  wordLevel: number;
  xpRewardAmount: number;
  username: string;
  userId: number;
  myId: number;
}) {
  const displayedUserLabel = useMemo(() => {
    if (userId === myId) {
      if (SELECTED_LANGUAGE === 'kr') {
        return '회원';
      }
      return 'You';
    }
    return (
      <UsernameText
        color="#fff"
        user={{
          id: userId,
          username
        }}
      />
    );
  }, [myId, userId, username]);

  const rewardAmountLabel = useMemo(
    () => addCommasToNumber(xpRewardAmount),
    [xpRewardAmount]
  );

  const solutionLabel = useMemo(
    () => (
      <>
        The word was <b>{solution}</b> (
        <b style={{ color: Color[wordLevelHash[wordLevel].color]() }}>
          {wordLevelHash[wordLevel].label}
        </b>{' '}
        word)
      </>
    ),
    [solution, wordLevel]
  );

  const guessLabel = useMemo(() => {
    if (wordleGuessReaction[numGuesses]) {
      return wordleGuessReaction[numGuesses];
    }
    return null;
  }, [numGuesses]);

  const guessLabelColor = useMemo(
    () =>
      numGuesses <= 2
        ? Color.gold()
        : numGuesses === 3
        ? Color.brownOrange()
        : Color.orange(),
    [numGuesses]
  );

  const bonusLabel = useMemo(() => {
    if (numGuesses < 3) {
      return null;
    }
    return isSolved && isStrict ? 'double reward bonus' : null;
  }, [isSolved, isStrict, numGuesses]);

  const resultLabel = useMemo(() => {
    return (
      <>
        {' '}
        {displayedUserLabel} earned{' '}
        <span
          className="reward-amount-label"
          style={{
            fontWeight: isSolved ? 'bold' : ''
          }}
        >
          {rewardAmountLabel} XP
        </span>{' '}
        for {isSolved ? 'solving' : 'trying to solve'} a Wordle{' '}
        {isSolved ? (
          <>
            in{' '}
            <span style={{ fontWeight: numGuesses <= 4 ? 'bold' : 'default' }}>
              {numGuesses} guess
              {numGuesses === 1
                ? '!!!'
                : numGuesses === 2
                ? 'es!!'
                : numGuesses === 3
                ? 'es!'
                : 'es'}
            </span>
          </>
        ) : (
          ''
        )}
      </>
    );
  }, [displayedUserLabel, isSolved, numGuesses, rewardAmountLabel]);

  return {
    bonusLabel,
    guessLabel,
    guessLabelColor,
    resultLabel,
    solutionLabel
  };
}
