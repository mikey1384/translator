import localize from '~/constants/localize';
import { Color } from '~/constants/css';

// ===========================
// General Configurations
// ===========================

export const months = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];
export const clientVersion = '1.9.42';
export const ADMIN_USER_ID = Number(import.meta.env.VITE_ADMIN_USER_ID);
export const CIEL_TWINKLE_ID = Number(import.meta.env.VITE_CIEL_TWINKLE_ID);
export const CIEL_PFP_URL = import.meta.env.VITE_CIEL_PFP_URL;
export const ZERO_TWINKLE_ID = Number(import.meta.env.VITE_ZERO_TWINKLE_ID);
export const ZERO_PFP_URL = import.meta.env.VITE_ZERO_PFP_URL;
export const cloudFrontURL = `https://${
  import.meta.env.VITE_CLOUDFRONT_KEY
}.cloudfront.net`;
export const S3URL = `https://${
  import.meta.env.VITE_AWS_S3_BUCKET_NAME
}.s3.amazonaws.com`;
export const TURN_USERNAME = import.meta.env.VITE_TURN_USERNAME;
export const TURN_PASSWORD = import.meta.env.VITE_TURN_PASSWORD;
export const SELECTED_LANGUAGE = import.meta.env.VITE_SELECTED_LANGUAGE || 'en';
export const mb = 1000;
export const mobileFullTextRevealShowDuration = 2000;
export const returnMissionThumb = (missionType: string): string =>
  `${cloudFrontURL}/missions/${missionType}/thumb.jpeg`;

// ===========================
// Chat
// ===========================

export const CHAT_ID_BASE_NUMBER = import.meta.env.VITE_CHAT_ID_BASE_NUMBER;
export const GENERAL_CHAT_ID = 2;
export const GENERAL_CHAT_PATH_ID =
  Number(GENERAL_CHAT_ID) + Number(CHAT_ID_BASE_NUMBER);
export const VOCAB_CHAT_TYPE = 'vocabulary';
export const AI_CARD_CHAT_TYPE = 'ai-cards';
export const MAX_AI_CALL_DURATION = 60 * 15;
export const GITHUB_APP_ID = import.meta.env.VITE_GITHUB_CLIENT_ID;
export const defaultChatSubject = 'Welcome!';
export const reactionsObj: Record<string, any> = {
  thumb: {
    label: 'thumb',
    position: '84% 82.5%'
  },
  heart: {
    label: 'heart',
    position: '84% 72.5%'
  },
  laughing: {
    label: 'laughing',
    position: '82% 7.5%'
  },
  wave: {
    label: 'wave',
    position: '28% 95%'
  },
  surprised: {
    label: 'surprised',
    position: '84% 20%'
  },
  crying: {
    label: 'crying',
    position: '54% 32.5%'
  },
  angry: {
    label: 'angry',
    position: '84% 5%'
  }
};

// ===========================
// Content
// ===========================

export const charLimit: {
  [key: string]: any;
} = {
  chat: {
    aiCard: 250,
    subject: 200,
    topic: 200,
    message: 50000
  },
  group: {
    description: 1000,
    name: 200
  },
  comment: 10000,
  interactive: {
    heading: 150,
    description: 5000,
    youtube: 300
  },
  playlist: {
    title: 200,
    description: 5000
  },
  videoQuestion: {
    title: 2000,
    choice: 2000
  },
  subject: {
    title: 300,
    description: 20000
  },
  rewardComment: 5000,
  statusMsg: 1000,
  url: {
    title: 300,
    description: 20000,
    url: 1000
  },
  video: {
    title: 200,
    description: 10000,
    url: 300
  }
};
export const defaultContentState = {
  isEditing: false,
  placeholderHeight: 0,
  rewards: [],
  comments: [],
  likes: [],
  pictures: [],
  questions: [],
  status: {},
  recommendations: [],
  subjects: [],
  tags: [],
  commentsLoadMoreButton: false,
  subjectsLoadMoreButton: false,
  rootObj: {},
  profileTheme: 'logoBlue',
  videos: [],
  loadMoreShown: false,
  loaded: false
};

// ===========================
// Users & Rewards
// ===========================

export const DEFAULT_PROFILE_THEME = 'logoBlue';
export const localStorageKeys: {
  [key: string]: string;
} = {
  canDelete: '',
  canEdit: '',
  canReward: '',
  canPinPlaylists: '',
  canEditPlaylists: '',
  canEditRewardLevel: '',
  karmaPoints: '',
  level: '',
  managementLevel: '',
  profilePicUrl: '',
  realName: '',
  title: '',
  userId: '',
  username: '',
  profileTheme: DEFAULT_PROFILE_THEME
};
export const DESCRIPTION_LENGTH_FOR_EXTRA_REWARD_LEVEL = 1000;
export const FILE_UPLOAD_XP_REQUIREMENT = 0;
export const LAST_ONLINE_FILTER_LABEL = localize('lastOnline2');
export const MAX_PROFILE_PIC_SIZE = 10000;
export const RANKING_FILTER_LABEL = localize('ranking');
export const REWARD_VALUE = 200;
export const returnMaxRewards = ({
  rewardLevel
}: {
  rewardLevel: number;
}): number => {
  let maxRewards = 5;
  if (rewardLevel > 0) {
    maxRewards = 10 * rewardLevel;
  }
  return maxRewards;
};
export const expectedResponseLength = (rewardLevel: number): number => {
  switch (rewardLevel) {
    case 5:
      return 700;
    case 4:
      return 450;
    case 3:
      return 250;
    case 2:
      return 100;
    default:
      return 30;
  }
};
export const rewardReasons: {
  [key: string]: any;
} = {
  1: {
    color: 'pink',
    icon: 'certificate',
    message: 'for being thoughtful'
  },
  2: {
    color: 'logoBlue',
    icon: 'comments',
    message: 'for posting something related to the topic'
  },
  3: {
    color: 'orange',
    icon: 'surprise',
    message: 'for posting something awesome'
  },
  4: {
    color: 'gold',
    icon: 'bolt',
    message: 'for putting in a lot of effort'
  },
  5: {
    color: 'green',
    icon: 'check-circle',
    message: 'for participating in a group project or event'
  }
};
export const videoRewardHash: { [key: string]: any } = {
  0: {
    xp: 100,
    coin: 10
  },
  1: {
    xp: 125,
    coin: 15
  },
  2: {
    xp: 150,
    coin: 15
  },
  3: {
    xp: 175,
    coin: 15
  },
  4: {
    xp: 200,
    coin: 20
  },
  5: {
    xp: 225,
    coin: 20
  },
  6: {
    xp: 250,
    coin: 20
  },
  7: {
    xp: 275,
    coin: 25
  },
  8: {
    xp: 300,
    coin: 25
  },
  9: {
    xp: 325,
    coin: 25
  },
  10: {
    xp: 350,
    coin: 30
  }
};

// ===========================
// Achievements & Roles
// ===========================

export const JR_MOD_LEVEL = 2;
export const MOD_LEVEL = 3;
export const SR_MOD_LEVEL = 4;
export const TEACHER_LEVEL = 5;
export const MENTOR_LABEL = 'Mentor';
export const SAGE_LABEL = 'Sage';
export const FOUNDER_LABEL = 'Founder';
export const ADMIN_MANAGEMENT_LEVEL = 3;
export const MISSION_MASTER_ACHIEVEMENT_ID = 1;
export const SUMMONER_ACHIEVEMENT_ID = 2;
export const MENTOR_ACHIEVEMENT_ID = 3;
export const SAGE_ACHIEVEMENT_ID = 4;
export const TWINKLE_FOUNDER_ACHIEVEMENT_ID = 5;
export const GRAMMAR_TYCOON_ACHIEVEMENT_ID = 6;
export const TEENAGER_ACHIEVEMENT_ID = 7;
export const ADULT_ACHIEVEMENT_ID = 8;
export const GOLD_ACHIEVEMENT_ID = 9;
export const MEETUP_ACHIEVEMENT_ID = 10;
export const achievementIdToType: Record<string, string> = {
  [MEETUP_ACHIEVEMENT_ID]: 'meetup',
  [TEENAGER_ACHIEVEMENT_ID]: 'teenager',
  [ADULT_ACHIEVEMENT_ID]: 'adult',
  [GRAMMAR_TYCOON_ACHIEVEMENT_ID]: 'grammar',
  [MISSION_MASTER_ACHIEVEMENT_ID]: 'mission',
  [MENTOR_ACHIEVEMENT_ID]: 'mentor',
  [SAGE_ACHIEVEMENT_ID]: 'sage',
  [TWINKLE_FOUNDER_ACHIEVEMENT_ID]: 'twinkle_founder',
  [SUMMONER_ACHIEVEMENT_ID]: 'summoner',
  [GOLD_ACHIEVEMENT_ID]: 'gold'
};
export const achievementTypeToId: Record<string, number> = {
  meetup: MEETUP_ACHIEVEMENT_ID,
  teenager: TEENAGER_ACHIEVEMENT_ID,
  adult: ADULT_ACHIEVEMENT_ID,
  grammar: GRAMMAR_TYCOON_ACHIEVEMENT_ID,
  mission: MISSION_MASTER_ACHIEVEMENT_ID,
  mentor: MENTOR_ACHIEVEMENT_ID,
  sage: SAGE_ACHIEVEMENT_ID,
  twinkle_founder: TWINKLE_FOUNDER_ACHIEVEMENT_ID,
  summoner: SUMMONER_ACHIEVEMENT_ID,
  gold: GOLD_ACHIEVEMENT_ID
};
export const roles: Record<string, string> = {
  [MENTOR_LABEL]: 'mentor',
  [SAGE_LABEL]: 'sage',
  [FOUNDER_LABEL]: 'twinkle_founder'
};
export const statsPerUserTypes: {
  [key: string]: {
    title: string | null;
    achievements: string[];
  };
} = {
  moderator: {
    title: 'moderator',
    achievements: ['teenager']
  },
  programmer: {
    title: 'programmer',
    achievements: ['teenager']
  },
  ['senior programmer']: {
    title: null,
    achievements: ['teenager', 'adult']
  },
  alumni: {
    title: null,
    achievements: ['teenager', 'adult']
  },
  teacher: {
    title: 'teacher',
    achievements: ['teenager', 'adult', 'mentor']
  },
  headteacher: {
    title: 'teacher',
    achievements: ['teenager', 'adult', 'mentor', 'sage']
  },
  headmaster: {
    title: 'headmaster',
    achievements: ['teenager', 'adult', 'mentor', 'sage', 'twinkle_founder']
  }
};

// ===========================
// Coins & AI Cards & Store
// ===========================

export const cardLevelHash: {
  [key: number]: {
    color: string;
    label: string;
  };
} = {
  1: {
    color: 'logoBlue',
    label: 'blue'
  },
  2: {
    color: 'pink',
    label: 'pink'
  },
  3: {
    color: 'orange',
    label: 'orange'
  },
  4: {
    color: 'magenta',
    label: 'magenta'
  },
  5: {
    color: 'gold',
    label: 'gold'
  },
  6: {
    color: 'midnightBlack',
    label: 'midnightBlack'
  }
};
export const cardProps: {
  [key: string]: string[];
} = {
  common: [],
  superior: ['glowy'],
  rare: ['glowy', 'glossy'],
  elite: ['glowy', 'glossy', 'grad'],
  legendary: ['glowy', 'glossy', 'sparky', 'grad']
};
export const karmaMultiplier = {
  post: 2,
  recommendation: {
    student: 10,
    teacher: 5
  }
};
export const karmaPointTable: any = {
  aiCard: 10_000,
  username: 50,
  file: {
    0: 500,
    1: 1_000,
    2: 2_000,
    3: 10_000,
    4: 25_000,
    5: 50_000,
    6: 100_000
  },
  profilePicture: {
    0: 1_000,
    1: 1_500,
    2: 2_000,
    3: 3_000,
    4: 4_000,
    5: 5_000,
    6: 6_000
  },
  rewardBoost: {
    0: 100,
    1: 200,
    2: 500,
    3: 800,
    4: 1_500,
    5: 2_200,
    6: 3_000,
    7: 5_000,
    8: 5_500,
    9: 8_000
  },
  moreToCome: 30_000
};
export const MAX_NUM_SUMMONS = 3;
export const maxSizes = [300, 400, 500, 650, 800, 1000, 1500, 2000];
export const returnMaxUploadSize = (fileUploadLvl: number): number => {
  return maxSizes[fileUploadLvl] * mb;
};
export const priceTable = {
  card: 100,
  chatSubject: 20,
  chatTheme: 30,
  grammarbles: 1000,
  username: 10,
  recommendation: 2,
  reward: 2
};
export const qualityProps: {
  [key: string]: {
    color: string;
    fontWeight: string;
  };
} = {
  common: {
    color: Color.vantaBlack(),
    fontWeight: 'normal'
  },
  superior: {
    color: Color.limeGreen(),
    fontWeight: 'bold'
  },
  rare: {
    color: Color.purple(),
    fontWeight: 'bold'
  },
  elite: {
    color: Color.redOrange(),
    fontWeight: 'bold'
  },
  legendary: {
    color: Color.darkGold(),
    fontWeight: 'bold'
  }
};
export const returnCardBurnXP = ({
  cardLevel,
  cardQuality
}: {
  cardLevel: number;
  cardQuality: 'common' | 'superior' | 'rare' | 'elite' | 'legendary';
}): number => {
  // base XP value
  let xp = 50;

  // color probabilities
  const colorProbs: { [level: number]: number } = {
    1: 0.5,
    2: 0.2,
    3: 0.15,
    4: 0.1,
    5: 0.05,
    6: 0.05
  };

  // adjust XP based on color
  xp *= 1 / colorProbs[cardLevel] ** 1.281774;

  // quality probabilities
  const qualityProbs: { [quality: string]: number } = {
    common: 0.5,
    superior: 0.3,
    rare: 0.13,
    elite: 0.05,
    legendary: 0.02
  };

  // adjust XP based on quality
  xp *= 1 / qualityProbs[cardQuality] ** 1.55;

  return Math.round(xp);
};

// ===========================
// Games
// ===========================

export const vocabRouletteChances = {
  better_luck: 50,
  coins_500: 20,
  coins_1000: 20,
  ai_card: 10
};

export const wordleGuessReaction: {
  [key: number]: string;
} = {
  1: 'JACKPOT',
  2: 'UNBELIEVABLE',
  3: 'BRILLIANT',
  4: 'IMPRESSIVE'
};
export const wordLevelHash: {
  [key: number]: {
    label: string;
    color: string;
  };
} = {
  0: {
    label: 'basic',
    color: 'logoBlue'
  },
  1: {
    label: 'basic',
    color: 'logoBlue'
  },
  2: {
    label: 'elementary',
    color: 'pink'
  },
  3: {
    label: 'intermediate',
    color: 'orange'
  },
  4: {
    label: 'advanced',
    color: 'red'
  },
  5: {
    label: 'epic',
    color: 'gold'
  }
};
export function returnWordLevel({
  frequency,
  word
}: {
  frequency?: number;
  word: string;
}): number {
  const intermediateWordFrequency = 4;
  const advancedWordFrequency = 2.5;
  const epicWordFrequency = 1.6;

  if (!frequency) return 3;
  if (frequency > intermediateWordFrequency) {
    if (word.length < 7) return 1;
    return 2;
  }
  if (word.slice(-2) === 'ly') return 3;
  if (frequency > advancedWordFrequency) return 3;
  if (frequency > epicWordFrequency) return 4;
  if (frequency <= epicWordFrequency) return 5;
  return 3;
}
