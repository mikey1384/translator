export const Color: {
  [key: string]: (opacity?: number) => string;
} = {
  blue: (opacity = 1) => `rgba(5,110,178,${opacity})`,
  lightBlue: (opacity = 1) => `rgba(117,192,255,${opacity})`,
  darkBlue: (opacity = 1) => `rgba(0,70,195,${opacity})`,
  logoBlue: (opacity = 1) => `rgba(65, 140, 235,${opacity})`,
  skyBlue: (opacity = 1) => `rgba(63,175,255,${opacity})`,
  littleBoyBlue: (opacity = 1) => `rgba(103,163,217,${opacity})`,
  lightOceanBlue: (opacity = 1) => `rgba(87,190,255,${opacity})`,
  oceanBlue: (opacity = 1) => `rgba(36,135,235,${opacity})`,
  darkOceanBlue: (opacity = 1) => `rgba(30,110,183,${opacity})`,
  darkerOceanBlue: (opacity = 1) => `rgba(13,85,173,${opacity})`,
  black: (opacity = 1) => `rgba(51,51,51,${opacity})`,
  brown: (opacity = 1) => `rgba(139,69,19,${opacity})`,
  lightBrown: (opacity = 1) => `rgba(150,125,76,${opacity})`,
  lighterBrown: (opacity = 1) => `rgba(175,135,70,${opacity})`,
  sandyBrown: (opacity = 1) => `rgba(230,204,96,${opacity})`,
  logoGreen: (opacity = 1) => `rgba(97,226,101,${opacity})`,
  cyan: (opacity = 1) => `rgba(0,255,255,${opacity})`,
  darkCyan: (opacity = 1) => `rgba(0,139,139,${opacity})`,
  green: (opacity = 1) => `rgba(40,182,44,${opacity})`,
  armyGreen: (opacity = 1) => `rgba(40,150,44,${opacity})`,
  blueGreen: (opacity = 1) => `rgba(59,150,160,${opacity})`,
  oceanGreen: (opacity = 1) => `rgba(35,166,213,${opacity})`,
  fernGreen: (opacity = 1) => `rgba(89,159,89,${opacity})`,
  limeGreen: (opacity = 1) => `rgba(34,197,94,${opacity})`,
  darkYellowGreen: (opacity = 1) => `rgba(135,180,76,${opacity})`,
  yellowGreen: (opacity = 1) => `rgba(154,204,96,${opacity})`,
  lightYellowGreen: (opacity = 1) => `rgba(175,224,96,${opacity})`,
  lightCyan: (opacity = 1) => `rgba(224,255,255,${opacity})`,
  blackGray: (opacity = 1) => `rgba(75,75,75,${opacity})`,
  darkerGray: (opacity = 1) => `rgba(85,85,85,${opacity})`,
  darkGray: (opacity = 1) => `rgba(115,115,115,${opacity})`,
  gray: (opacity = 1) => `rgba(153,153,153,${opacity})`,
  lightGray: (opacity = 1) => `rgba(165,165,165,${opacity})`,
  darkerBorderGray: (opacity = 1) => `rgba(185,188,190,${opacity})`,
  lighterGray: (opacity = 1) => `rgba(207,207,207,${opacity})`,
  extraLightGray: (opacity = 1) => `rgba(242,242,242,${opacity})`,
  blueGray: (opacity = 1) => `rgba(61,75,95,${opacity})`,
  lightBlueGray: (opacity = 1) => `rgba(91,105,125,${opacity})`,
  darkBlueGray: (opacity = 1) => `rgba(41,55,75,${opacity})`,
  lightBluerGray: (opacity = 1) => `rgba(71,105,155,${opacity})`,
  bluerGray: (opacity = 1) => `rgba(65,95,135,${opacity})`,
  darkBluerGray: (opacity = 1) => `rgba(51,65,115,${opacity})`,
  borderGray: (opacity = 1) => `rgba(204,204,204,${opacity})`,
  checkboxAreaGray: (opacity = 1) => `rgba(229,229,229,${opacity})`,
  targetGray: (opacity = 1) => `rgba(218,218,230,${opacity})`,
  wellGray: (opacity = 1) => `rgba(235,235,235,${opacity})`,
  inputGray: (opacity = 1) => `rgba(238,238,245,${opacity})`,
  highlightGray: (opacity = 1) => `rgba(242,242,242,${opacity})`,
  whiteBlueGray: (opacity = 1) => `rgba(248,248,255,${opacity})`,
  whiteGray: (opacity = 1) => `rgba(250,250,250,${opacity})`,
  ivory: (opacity = 1) => `rgba(255,255,240,${opacity})`,
  redOrange: (opacity = 1) => `rgba(240,100,70,${opacity})`,
  darkBrownOrange: (opacity = 1) => `rgba(235,160,70,${opacity})`,
  brownOrange: (opacity = 1) => `rgba(245,190,70,${opacity})`,
  orange: (opacity = 1) => `rgba(255,140,0,${opacity})`,
  lavender: (opacity = 1) => `rgba(200,200,230,${opacity})`,
  lightOrange: (opacity = 1) => `rgba(255,175,75,${opacity})`,
  lighterOrange: (opacity = 1) => `rgba(255,205,90,${opacity})`,
  pinkOrange: (opacity = 1) => `rgba(250,120,110,${opacity})`,
  passionFruit: (opacity = 1) => `rgba(243,103,123,${opacity})`,
  peach: (opacity = 1) => `rgba(255,175,150,${opacity})`,
  pink: (opacity = 1) => `rgba(255,105,180,${opacity})`,
  strongPink: (opacity = 1) => `rgba(255,85,185,${opacity})`,
  pastelPink: (opacity = 1) => `rgba(255,155,165,${opacity})`,
  bronze: (opacity = 1) => `rgba(255,190,130,${opacity})`,
  cranberry: (opacity = 1) => `rgba(230,80,112,${opacity})`,
  purple: (opacity = 1) => `rgba(152,28,235,${opacity})`,
  darkPurple: (opacity = 1) => `rgba(72,43,200,${opacity})`,
  lightPurple: (opacity = 1) => `rgba(225,105,255,${opacity})`,
  whitePurple: (opacity = 1) => `rgba(248,246,255,${opacity})`,
  lightRed: (opacity = 1) => `rgba(255,130,134,${opacity})`,
  red: (opacity = 1) => `rgba(255,65,54,${opacity})`,
  darkRed: (opacity = 1) => `rgba(235,0,60,${opacity})`,
  magenta: (opacity = 1) => `rgba(223,50,150,${opacity})`,
  rose: (opacity = 1) => `rgba(223,0,102,${opacity})`,
  midnightBlack: (opacity = 1) => `rgba(10,15,50,${opacity})`,
  vantaBlack: (opacity = 1) => `rgba(0,0,0,${opacity})`,
  white: (opacity = 1) => `rgba(255,255,255,${opacity})`,
  brightGold: (opacity = 1) => `rgba(255,213,100,${opacity})`,
  gold: (opacity = 1) => `rgba(255,203,50,${opacity})`,
  darkGold: (opacity = 1) => `rgba(250,193,50,${opacity})`,
  goldOrange: (opacity = 1) => `rgba(255,185,60,${opacity})`,
  yellow: (opacity = 1) => `rgba(255,255,55,${opacity})`
};

export const strongColors = ['rose', 'red', 'purple'];

export function Theme(color = 'logoBlue'): {
  [key: string]: {
    color: string;
    opacity?: number;
    shadow?: string;
  };
} {
  return {
    abort: {
      color: 'darkerGray'
    },
    action: {
      color:
        {
          green: 'logoBlue',
          orange: 'pinkOrange',
          rose: 'cranberry',
          purple: 'purple',
          black: 'darkOceanBlue',
          red: 'magenta',
          darkBlue: 'armyGreen',
          vantaBlack: 'armyGreen'
        }[color] || 'green'
    },
    active: { color: { green: 'pinkOrange' }[color] || 'green' },
    alert: {
      color: 'gold'
    },
    alreadyPostedByOtherUser: { color: 'red' },
    alreadyPostedByThisUser: { color: 'blue' },
    background: {
      color:
        {
          gold: 'whiteBlueGray'
        }[color] || 'whiteGray'
    },
    button: {
      color:
        {
          gold: 'brownOrange'
        }[color] || color
    },
    buttonHovered: {
      color:
        {
          gold: 'gold'
        }[color] || color
    },
    byUserIndicator: {
      color:
        {
          gold: 'darkGold'
        }[color] || color,
      opacity: strongColors.includes(color) ? 0.7 : 0.9
    },
    byUserIndicatorText: {
      color: 'white',
      shadow:
        {
          gold: 'orange'
        }[color] || ''
    },
    carousel: { color },
    carouselProgress: { color: 'logoBlue' },
    carouselProgressComplete: { color: 'blue' },
    chatFlatButton: {
      color:
        {
          gold: 'brownOrange'
        }[color] || color,
      opacity:
        {
          gold: 1
        }[color] || 0.8
    },
    chatFlatButtonHovered: {
      color:
        {
          gold: 'gold'
        }[color] || color
    },
    chatFlatButtonText: {
      color: 'white',
      shadow:
        {
          gold: 'darkBrownOrange'
        }[color] || ''
    },
    chatGroup: {
      color:
        {
          gold: 'pinkOrange'
        }[color] || 'logoBlue'
    },
    chatInvitation: {
      color:
        {
          gold: 'darkGold'
        }[color] || color
    },
    chatTopic: {
      color:
        {
          gold: 'brownOrange'
        }[color] || color
    },
    chatUnread: {
      color:
        {
          green: 'lightYellowGreen',
          rose: 'cranberry',
          red: 'redOrange',
          black: 'darkerGray',
          vantaBlack: 'black',
          gold: 'logoBlue'
        }[color] || color
    },
    content: {
      color:
        {
          green: 'logoBlue',
          orange: 'pinkOrange',
          rose: 'cranberry',
          pink: 'passionFruit',
          purple: 'purple',
          black: 'darkOceanBlue',
          red: 'magenta',
          darkBlue: 'armyGreen',
          vantaBlack: 'armyGreen'
        }[color] || 'green'
    },
    cover: { color },
    coverText: {
      color: 'white',
      shadow:
        {
          gold: 'darkBrownOrange'
        }[color] || ''
    },
    todayProgressText: {
      color,
      shadow:
        {
          gold: 'darkGold'
        }[color] || ''
    },
    danger: {
      color:
        {
          red: 'darkRed',
          vantaBlack: 'black',
          gold: 'magenta'
        }[color] || 'rose'
    },
    done: { color: 'blue' },
    draw: { color: 'logoBlue' },
    fail: { color: 'black' },
    filter: {
      color:
        {
          gold: 'brownOrange'
        }[color] || color,
      opacity:
        {
          gold: 1
        }[color] || 0.7
    },
    filterText: {
      color: 'white',
      shadow:
        {
          gold: 'darkBrownOrange'
        }[color] || ''
    },
    invertedFilterActive: { color },
    filterActive: {
      color:
        {
          gold: 'darkGold'
        }[color] || color
    },
    generalChat: {
      color:
        {
          black: 'darkBlue',
          vantaBlack: 'darkBlue',
          gold: 'logoBlue'
        }[color] || color
    },
    grammarGameScorePerfect: { color: 'brownOrange' },
    grammarGameScoreS: { color: 'gold' },
    grammarGameScoreA: { color: 'magenta' },
    grammarGameScoreB: { color: 'orange' },
    grammarGameScoreC: { color: 'pink' },
    grammarGameScoreD: { color: 'logoBlue' },
    grammarGameScoreF: { color: 'gray' },
    header: {
      color: 'white'
    },
    homeMenuItemActive: { color },
    info: {
      color:
        {
          green: 'yellowGreen',
          orange: 'lightOrange',
          rose: 'pastelPink',
          pink: 'pink',
          purple: 'lightPurple',
          black: 'logoBlue',
          red: 'lightRed',
          darkBlue: 'oceanBlue',
          vantaBlack: 'oceanBlue',
          gold: 'lightOrange'
        }[color] || 'lightOceanBlue'
    },
    itemSelected: { color, opacity: strongColors.includes(color) ? 0.7 : 0.8 },
    level1: { color: 'logoBlue' },
    level2: { color: 'pink' },
    level3: { color: 'orange' },
    level4: { color: 'magenta' },
    level5: { color: 'gold' },
    likeButton: {
      color:
        {
          green: 'yellowGreen',
          rose: 'skyBlue',
          red: 'pinkOrange',
          gold: 'lightOceanBlue'
        }[color] || 'lightBlue'
    },
    likeButtonPressed: {
      color:
        {
          green: 'darkYellowGreen',
          rose: 'oceanBlue',
          red: 'passionFruit'
        }[color] || 'logoBlue'
    },
    link: {
      color:
        {
          green: 'fernGreen',
          orange: 'darkOceanBlue',
          rose: 'darkOceanBlue',
          pink: 'oceanBlue',
          black: 'blueGray',
          vantaBlack: 'darkerOceanBlue',
          gold: 'oceanBlue'
        }[color] || 'blue'
    },
    listItemMarker: {
      color: 'darkerGray'
    },
    loadMoreButton: {
      color:
        {
          green: 'lightYellowGreen',
          orange: 'lighterOrange',
          rose: 'passionFruit',
          pink: 'pastelPink',
          purple: 'lightPurple',
          black: 'darkGray',
          red: 'lightRed',
          darkBlue: 'lightOceanBlue',
          vantaBlack: 'black',
          gold: 'lightOceanBlue'
        }[color] || 'lightBlue'
    },
    login: { color: 'green' },
    logoTwin: { color: 'logoBlue' },
    logoKle: { color: { gold: 'darkGold' }[color] || 'logoGreen' },
    mention: {
      color: { pink: 'orange', gold: 'magenta' }[color] || 'passionFruit'
    },
    mission: { color: 'orange' },
    myCollection: {
      color,
      shadow:
        {
          gold: 'darkBrownOrange'
        }[color] || ''
    },
    profilePanel: { color },
    progressBar: { color: { green: 'yellowGreen' }[color] || color },
    reactionButton: { color, opacity: 0.2 },
    recommendation: { color: { gold: 'passionFruit' }[color] || 'brownOrange' },
    reward: {
      color:
        {
          green: 'pinkOrange',
          orange: 'pastelPink',
          pink: 'strongPink',
          red: 'strongPink',
          rose: 'strongPink',
          purple: 'strongPink',
          darkBlue: 'strongPink'
        }[color] || 'pink'
    },
    rewardLevelForm: { color, opacity: strongColors.includes(color) ? 0.9 : 1 },
    rewardableRecommendation: { color, opacity: 0.1 },
    search: {
      color,
      shadow:
        {
          gold: 'darkBrownOrange'
        }[color] || ''
    },
    sectionPanel: { color },
    sectionPanelText: {
      color:
        {
          gold: 'darkGold'
        }[color] || color,
      shadow:
        {
          gold: 'darkBrownOrange'
        }[color] || ''
    },
    showMeAnotherSubjectButton: { color: 'green' },
    showMeAnotherPostButton: { color: 'green' },
    skeuomorphicDisabled: { color, opacity: 0.2 },
    spinner: { color },
    statusMsgLink: {
      color: { ivory: 'blue', orange: 'yellow', red: 'yellow' }[color] || 'gold'
    },
    statusMsgListItemMarker: {
      color: { ivory: 'darkerGray' }[color] || 'white'
    },
    success: { color: 'green' },
    switch: { color },
    topicText: {
      color,
      shadow:
        {
          gold: 'darkBrownOrange'
        }[color] || ''
    },
    tableHeader: { color },
    userLink: {
      color:
        {
          green: 'blueGreen',
          orange: 'darkBrownOrange',
          rose: 'passionFruit',
          pink: 'strongPink',
          gold: 'darkGold'
        }[color] || color
    },
    verifyEmail: {
      color:
        {
          green: 'green'
        }[color] || color
    },
    victory: { color: 'brownOrange' },
    warning: { color: 'redOrange' },
    xpNumber: { color: 'logoGreen' }
  };
}

export const getThemeStyles = (theme: string, opacity: number = 1) => {
  const themeColors: Record<string, any> = {
    logoBlue: {
      bg: `rgba(65, 140, 235, ${opacity})`,
      disabledBg: `rgba(65, 140, 235, ${opacity * 0.5})`,
      hoverBg: `rgba(53, 122, 189, ${opacity})`,
      text: `rgba(255, 255, 255, ${opacity})`,
      border: `rgba(40, 90, 156, ${opacity})`,
      disabledBorder: `rgba(48, 102, 190, ${opacity * 0.5})`,
      rewardStatusBg: `rgba(5, 75, 160, ${opacity * 0.5})`,
      rewardStatusGradient: `rgba(205, 210, 255, 0.1)`,
      perfectStarColor: `rgba(255, 215, 0, ${opacity})`
    },
    green: {
      bg: `rgba(40, 182, 44, ${opacity})`,
      disabledBg: `rgba(40, 182, 44, ${opacity * 0.5})`,
      hoverBg: `rgba(35, 138, 38, ${opacity})`,
      text: `rgba(255, 255, 255, ${opacity})`,
      border: `rgba(26, 109, 26, ${opacity})`,
      disabledBorder: `rgba(31, 126, 29, ${opacity * 0.5})`,
      rewardStatusBg: `rgba(35, 138, 38, ${opacity * 0.5})`,
      rewardStatusGradient: `rgba(205, 255, 210, 0.1)`,
      perfectStarColor: `rgba(255, 215, 0, ${opacity})`
    },
    orange: {
      bg: `rgba(255, 140, 0, ${opacity})`,
      disabledBg: `rgba(255, 140, 0, ${opacity * 0.5})`,
      hoverBg: `rgba(230, 126, 0, ${opacity})`,
      text: `rgba(255, 255, 255, ${opacity})`,
      border: `rgba(184, 96, 0, ${opacity})`,
      disabledBorder: `rgba(204, 112, 0, ${opacity * 0.5})`,
      rewardStatusBg: `rgba(204, 102, 0, ${opacity * 0.5})`,
      rewardStatusGradient: `rgba(255, 235, 210, 0.12)`,
      perfectStarColor: `rgba(255, 236, 61, ${opacity})`
    },
    rose: {
      bg: `rgba(255, 0, 127, ${opacity})`,
      disabledBg: `rgba(255, 0, 127, ${opacity * 0.5})`,
      hoverBg: `rgba(230, 0, 115, ${opacity})`,
      text: `rgba(255, 255, 255, ${opacity})`,
      border: `rgba(204, 0, 102, ${opacity})`,
      disabledBorder: `rgba(230, 0, 115, ${opacity * 0.5})`,
      rewardStatusBg: `rgba(230, 0, 115, ${opacity * 0.5})`,
      rewardStatusGradient: `rgba(255, 255, 255, 0.1)`,
      perfectStarColor: `rgba(255, 236, 61, ${opacity})`
    },
    pink: {
      bg: `rgba(255, 105, 180, ${opacity})`,
      disabledBg: `rgba(255, 105, 180, ${opacity * 0.5})`,
      hoverBg: `rgba(255, 92, 161, ${opacity})`,
      text: `rgba(255, 255, 255, ${opacity})`,
      border: `rgba(255, 76, 139, ${opacity})`,
      disabledBorder: `rgba(255, 92, 161, ${opacity * 0.5})`,
      rewardStatusBg: `rgba(255, 92, 161, ${opacity * 0.5})`,
      rewardStatusGradient: `rgba(255, 255, 255, 0.1)`,
      perfectStarColor: `rgba(255, 236, 61, ${opacity})`
    },
    purple: {
      bg: `rgba(128, 0, 128, ${opacity})`,
      disabledBg: `rgba(128, 0, 128, ${opacity * 0.5})`,
      hoverBg: `rgba(115, 0, 115, ${opacity})`,
      text: `rgba(255, 255, 255, ${opacity})`,
      border: `rgba(102, 0, 102, ${opacity})`,
      disabledBorder: `rgba(115, 0, 115, ${opacity * 0.5})`,
      rewardStatusBg: `rgba(115, 0, 115, ${opacity * 0.5})`,
      rewardStatusGradient: `rgba(255, 255, 255, 0.1)`,
      perfectStarColor: `rgba(255, 236, 61, ${opacity})`
    },
    black: {
      bg: `rgba(0, 0, 0, ${opacity})`,
      disabledBg: `rgba(0, 0, 0, ${opacity * 0.5})`,
      hoverBg: `rgba(51, 51, 51, ${opacity})`,
      text: `rgba(255, 255, 255, ${opacity})`,
      border: `rgba(44, 44, 44, ${opacity})`,
      disabledBorder: `rgba(51, 51, 51, ${opacity * 0.5})`,
      rewardStatusBg: `rgba(51, 51, 51, ${opacity * 0.5})`,
      rewardStatusGradient: `rgba(255, 255, 255, 0.1)`,
      perfectStarColor: `rgba(255, 215, 0, ${opacity})`
    },
    red: {
      bg: `rgba(240,100,70, ${opacity})`,
      disabledBg: `rgba(240,100,70, ${opacity * 0.5})`,
      hoverBg: `rgba(240, 50, 0, ${opacity})`,
      text: `rgba(255, 255, 255, ${opacity})`,
      border: `rgba(204, 0, 0, ${opacity})`,
      disabledBorder: `rgba(229, 0, 0, ${opacity * 0.5})`,
      rewardStatusBg: `rgba(204, 0, 0, ${opacity * 0.5})`,
      rewardStatusGradient: `rgba(255, 255, 255, 0.1)`,
      perfectStarColor: `rgba(255, 236, 61, ${opacity})`
    },
    darkBlue: {
      bg: `rgba(0, 0, 139, ${opacity})`,
      disabledBg: `rgba(0, 0, 139, ${opacity * 0.5})`,
      hoverBg: `rgba(0, 0, 119, ${opacity})`,
      text: `rgba(255, 255, 255, ${opacity})`,
      border: `rgba(0, 0, 102, ${opacity})`,
      disabledBorder: `rgba(0, 0, 119, ${opacity * 0.5})`,
      rewardStatusBg: `rgba(0, 51, 153, ${opacity * 0.5})`,
      rewardStatusGradient: `rgba(205, 225, 255, 0.1)`,
      perfectStarColor: `rgba(255, 215, 0, ${opacity})`
    },
    vantaBlack: {
      bg: `rgba(0, 0, 0, ${opacity})`,
      disabledBg: `rgba(0, 0, 0, ${opacity * 0.5})`,
      hoverBg: `rgba(51, 51, 51, ${opacity})`,
      text: `rgba(255, 255, 255, ${opacity})`,
      border: `rgba(44, 44, 44, ${opacity})`,
      disabledBorder: `rgba(51, 51, 51, ${opacity * 0.5})`,
      rewardStatusBg: `rgba(0, 0, 0, ${opacity * 0.6})`,
      rewardStatusGradient: `rgba(255, 255, 255, 0.08)`,
      perfectStarColor: `rgba(255, 215, 0, ${opacity})`
    },
    gold: {
      bg: `rgba(255, 215, 0, ${opacity})`,
      disabledBg: `rgba(255, 215, 0, ${opacity * 0.5})`,
      hoverBg: `rgba(230, 195, 0, ${opacity})`,
      text: `rgba(255, 255, 255, ${opacity})`,
      border: `rgba(204, 163, 0, ${opacity})`,
      disabledBorder: `rgba(230, 195, 0, ${opacity * 0.5})`,
      rewardStatusBg: `rgba(204, 163, 0, ${opacity * 0.5})`,
      rewardStatusGradient: `rgba(255, 248, 220, 0.15)`,
      perfectStarColor: `rgba(255, 240, 0, ${opacity})`
    }
  };

  return (
    themeColors[theme] || {
      bg: `rgba(153, 153, 153, ${opacity})`,
      hoverBg: `rgba(128, 128, 128, ${opacity})`,
      text: `rgba(0, 0, 0, ${opacity})`,
      border: `rgba(112, 112, 112, ${opacity})`,
      rewardStatusBg: `rgba(5, 75, 160, ${opacity * 0.5})`,
      rewardStatusGradient: `rgba(205, 210, 255, 0.1)`,
      perfectStarColor: `rgba(255, 215, 0, ${opacity})`
    }
  );
};

export const borderRadius = '4px';
export const mediumBorderRadius = '8px';
export const wideBorderRadius = '12px';
export const liftedBoxShadow = '0 4px 8px rgba(0, 0, 0, 0.1)';
export const liftedBoxShadowDarker = '0 4px 8px rgba(0, 0, 0, 0.2)';
export const liftedBoxShadowDarkest = '0 4px 8px rgba(0, 0, 0, 0.3)';
export const liftedEffect = {
  boxShadow: liftedBoxShadow,
  borderRadius: wideBorderRadius
};
export const innerBorderRadius = '3px';
export const mobileMaxWidth = '767px';
export const tabletMaxWidth = '820px';
export const desktopMinWidth = '768px';
