import sourceGapCleanupOverrides from './sync-source-gap-cleanup-overrides.js';
import sourceGapOverrides from './sync-source-gap-overrides.js';
import localeGapOverrides from './sync-locale-gap-overrides.js';

const baseOverrides = {
  af: {
    'admin.title': 'Administrateur',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'GPT-5.1 konsep + GPT-5.4 hersiening',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'Slegs GPT-5.1-konsep',
    'settings.performanceQuality.qualitySummary.modelOn':
      'GPT-5.4 diep ontleding + hoogtepuntknipsels',
    'settings.performanceQuality.qualitySummary.modelOff':
      'GPT-5.1 standaardontleding',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'ElevenLabs TTS-premiumstemme',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} krediete/uur',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} krediete/min',
    'settings.performanceQuality.rate.perSearch':
      '~{{credits}} krediete/soektog',
    'settings.performanceQuality.rate.balance': 'Saldo: ~{{time}}',
  },
  ar: {
    'admin.title': 'المسؤول',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'مسودة GPT-5.1 + مراجعة GPT-5.4',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'مسودة GPT-5.1 فقط',
    'settings.performanceQuality.qualitySummary.modelOn':
      'تحليل عميق بـ GPT-5.4 + مقاطع مميزة',
    'settings.performanceQuality.qualitySummary.modelOff':
      'تحليل قياسي بـ GPT-5.1',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'أصوات ElevenLabs TTS المميزة',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} أرصدة/ساعة',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} أرصدة/دقيقة',
    'settings.performanceQuality.rate.perSearch': '~{{credits}} أرصدة/بحث',
    'settings.performanceQuality.rate.balance': 'الرصيد: ~{{time}}',
  },
  bn: {
    'admin.title': 'প্রশাসক',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'GPT-5.1 খসড়া + GPT-5.4 রিভিউ',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'শুধু GPT-5.1 খসড়া',
    'settings.performanceQuality.qualitySummary.modelOn':
      'GPT-5.4 গভীর বিশ্লেষণ + হাইলাইট ক্লিপ',
    'settings.performanceQuality.qualitySummary.modelOff':
      'GPT-5.1 মানক বিশ্লেষণ',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'ElevenLabs TTS প্রিমিয়াম ভয়েস',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} ক্রেডিট/ঘণ্টা',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} ক্রেডিট/মিনিট',
    'settings.performanceQuality.rate.perSearch': '~{{credits}} ক্রেডিট/সার্চ',
    'settings.performanceQuality.rate.balance': 'ব্যালান্স: ~{{time}}',
  },
  cs: {
    'admin.title': 'Administrátor',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'Návrh GPT-5.1 + kontrola GPT-5.4',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'Pouze návrh GPT-5.1',
    'settings.performanceQuality.qualitySummary.modelOn':
      'Hloubková analýza GPT-5.4 + highlight klipy',
    'settings.performanceQuality.qualitySummary.modelOff':
      'Standardní analýza GPT-5.1',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'Prémiové hlasy ElevenLabs TTS',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} kreditů/hod',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} kreditů/min',
    'settings.performanceQuality.rate.perSearch':
      '~{{credits}} kreditů/hledání',
    'settings.performanceQuality.rate.balance': 'Zůstatek: ~{{time}}',
  },
  da: {
    'admin.title': 'Administrator',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'GPT-5.1-kladde + GPT-5.4-review',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'Kun GPT-5.1-kladde',
    'settings.performanceQuality.qualitySummary.modelOn':
      'GPT-5.4 dybdeanalyse + highlight-klip',
    'settings.performanceQuality.qualitySummary.modelOff':
      'GPT-5.1 standardanalyse',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'ElevenLabs TTS-premiumstemmer',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} kreditter/time',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} kreditter/min',
    'settings.performanceQuality.rate.perSearch':
      '~{{credits}} kreditter/sogning',
    'settings.performanceQuality.rate.balance': 'Saldo: ~{{time}}',
  },
  de: {
    'admin.title': 'Administrator',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'GPT-5.1-Entwurf + GPT-5.4-Review',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'Nur GPT-5.1-Entwurf',
    'settings.performanceQuality.qualitySummary.modelOn':
      'GPT-5.4-Tiefenanalyse + Highlight-Clips',
    'settings.performanceQuality.qualitySummary.modelOff':
      'GPT-5.1-Standardanalyse',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'ElevenLabs TTS mit Premium-Stimmen',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} Credits/Stunde',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} Credits/Min.',
    'settings.performanceQuality.rate.perSearch': '~{{credits}} Credits/Suche',
    'settings.performanceQuality.rate.balance': 'Guthaben: ~{{time}}',
  },
  el: {
    'admin.title': 'Διαχειριστής',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'Πρόχειρο GPT-5.1 + έλεγχος GPT-5.4',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'Μόνο πρόχειρο GPT-5.1',
    'settings.performanceQuality.qualitySummary.modelOn':
      'Βαθιά ανάλυση GPT-5.4 + αποσπάσματα highlight',
    'settings.performanceQuality.qualitySummary.modelOff':
      'Τυπική ανάλυση GPT-5.1',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'Premium φωνές ElevenLabs TTS',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} πιστώσεις/ώρα',
    'settings.performanceQuality.rate.perMinute':
      '~{{credits}} πιστώσεις/λεπτό',
    'settings.performanceQuality.rate.perSearch':
      '~{{credits}} πιστώσεις/αναζήτηση',
    'settings.performanceQuality.rate.balance': 'Υπόλοιπο: ~{{time}}',
  },
  es: {
    'admin.title': 'Administrador',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'Borrador con GPT-5.1 + revisión con GPT-5.4',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'Solo borrador con GPT-5.1',
    'settings.performanceQuality.qualitySummary.modelOn':
      'Análisis profundo con GPT-5.4 + clips destacados',
    'settings.performanceQuality.qualitySummary.modelOff':
      'Análisis estándar con GPT-5.1',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'Voces premium de ElevenLabs TTS',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} créditos/hora',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} créditos/min',
    'settings.performanceQuality.rate.perSearch':
      '~{{credits}} créditos/búsqueda',
    'settings.performanceQuality.rate.balance': 'Saldo: ~{{time}}',
  },
  fa: {
    'admin.title': 'مدیر',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'پیش‌نویس GPT-5.1 + بازبینی GPT-5.4',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'فقط پیش‌نویس GPT-5.1',
    'settings.performanceQuality.qualitySummary.modelOn':
      'تحلیل عمیق GPT-5.4 + کلیپ‌های هایلایت',
    'settings.performanceQuality.qualitySummary.modelOff':
      'تحلیل استاندارد GPT-5.1',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'صداهای پریمیوم ElevenLabs TTS',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} اعتبار/ساعت',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} اعتبار/دقیقه',
    'settings.performanceQuality.rate.perSearch': '~{{credits}} اعتبار/جستجو',
    'settings.performanceQuality.rate.balance': 'موجودی: ~{{time}}',
  },
  fi: {
    'admin.title': 'Ylläpitäjä',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'GPT-5.1-luonnos + GPT-5.4-tarkistus',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'Vain GPT-5.1-luonnos',
    'settings.performanceQuality.qualitySummary.modelOn':
      'GPT-5.4-syväanalyysi + kohokohtaklipit',
    'settings.performanceQuality.qualitySummary.modelOff':
      'GPT-5.1-perusanalyysi',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'ElevenLabs TTS -premiumäänet',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} krediittiä/tunti',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} krediittiä/min',
    'settings.performanceQuality.rate.perSearch':
      '~{{credits}} krediittiä/haku',
    'settings.performanceQuality.rate.balance': 'Saldo: ~{{time}}',
  },
  fr: {
    'admin.title': 'Administrateur',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'Brouillon GPT-5.1 + révision GPT-5.4',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'Brouillon GPT-5.1 seulement',
    'settings.performanceQuality.qualitySummary.modelOn':
      'Analyse approfondie GPT-5.4 + extraits marquants',
    'settings.performanceQuality.qualitySummary.modelOff':
      'Analyse standard GPT-5.1',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'Voix premium ElevenLabs TTS',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} crédits/heure',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} crédits/min',
    'settings.performanceQuality.rate.perSearch':
      '~{{credits}} crédits/recherche',
    'settings.performanceQuality.rate.balance': 'Solde : ~{{time}}',
  },
  he: {
    'admin.title': 'מנהל מערכת',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'טיוטת GPT-5.1 + סקירת GPT-5.4',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'טיוטת GPT-5.1 בלבד',
    'settings.performanceQuality.qualitySummary.modelOn':
      'ניתוח מעמיק ב-GPT-5.4 + קטעי הדגשה',
    'settings.performanceQuality.qualitySummary.modelOff':
      'ניתוח רגיל ב-GPT-5.1',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'קולות פרימיום של ElevenLabs TTS',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} קרדיטים/שעה',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} קרדיטים/דקה',
    'settings.performanceQuality.rate.perSearch': '~{{credits}} קרדיטים/חיפוש',
    'settings.performanceQuality.rate.balance': 'יתרה: ~{{time}}',
  },
  hi: {
    'admin.title': 'प्रशासक',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'GPT-5.1 ड्राफ्ट + GPT-5.4 समीक्षा',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'सिर्फ GPT-5.1 ड्राफ्ट',
    'settings.performanceQuality.qualitySummary.modelOn':
      'GPT-5.4 गहन विश्लेषण + हाइलाइट क्लिप',
    'settings.performanceQuality.qualitySummary.modelOff':
      'GPT-5.1 मानक विश्लेषण',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'ElevenLabs TTS प्रीमियम आवाज़ें',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} क्रेडिट/घंटा',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} क्रेडिट/मिनट',
    'settings.performanceQuality.rate.perSearch': '~{{credits}} क्रेडिट/खोज',
    'settings.performanceQuality.rate.balance': 'बैलेंस: ~{{time}}',
  },
  hu: {
    'admin.title': 'Adminisztrátor',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'GPT-5.1-vázlat + GPT-5.4-ellenőrzés',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'Csak GPT-5.1-vázlat',
    'settings.performanceQuality.qualitySummary.modelOn':
      'GPT-5.4 mélyelemzés + kiemelt klipek',
    'settings.performanceQuality.qualitySummary.modelOff':
      'GPT-5.1 standard elemzés',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'ElevenLabs TTS prémium hangok',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} kredit/óra',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} kredit/perc',
    'settings.performanceQuality.rate.perSearch': '~{{credits}} kredit/keresés',
    'settings.performanceQuality.rate.balance': 'Egyenleg: ~{{time}}',
  },
  id: {
    'admin.title': 'Administrator',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'Draf GPT-5.1 + ulasan GPT-5.4',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'Hanya draf GPT-5.1',
    'settings.performanceQuality.qualitySummary.modelOn':
      'Analisis mendalam GPT-5.4 + klip sorotan',
    'settings.performanceQuality.qualitySummary.modelOff':
      'Analisis standar GPT-5.1',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'Suara premium ElevenLabs TTS',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} kredit/jam',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} kredit/menit',
    'settings.performanceQuality.rate.perSearch':
      '~{{credits}} kredit/pencarian',
    'settings.performanceQuality.rate.balance': 'Saldo: ~{{time}}',
  },
  it: {
    'admin.title': 'Amministratore',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'Bozza GPT-5.1 + revisione GPT-5.4',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'Solo bozza GPT-5.1',
    'settings.performanceQuality.qualitySummary.modelOn':
      'Analisi approfondita GPT-5.4 + clip in evidenza',
    'settings.performanceQuality.qualitySummary.modelOff':
      'Analisi standard GPT-5.1',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'Voci premium ElevenLabs TTS',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} crediti/ora',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} crediti/min',
    'settings.performanceQuality.rate.perSearch':
      '~{{credits}} crediti/ricerca',
    'settings.performanceQuality.rate.balance': 'Saldo: ~{{time}}',
  },
  ja: {
    'admin.title': '管理者',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'GPT-5.1ドラフト + GPT-5.4レビュー',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'GPT-5.1ドラフトのみ',
    'settings.performanceQuality.qualitySummary.modelOn':
      'GPT-5.4詳細分析 + ハイライトクリップ',
    'settings.performanceQuality.qualitySummary.modelOff': 'GPT-5.1標準分析',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'ElevenLabs TTS プレミアム音声',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} クレジット/時間',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} クレジット/分',
    'settings.performanceQuality.rate.perSearch':
      '~{{credits}} クレジット/検索',
    'settings.performanceQuality.rate.balance': '残高: ~{{time}}',
  },
  ko: {
    'admin.title': '관리자',
    'settings.performanceQuality.qualityTranslation.modelOn':
      '표준 초안 + OpenAI 고급 검토',
    'settings.performanceQuality.qualityTranslation.modelOnAnthropic':
      '표준 초안 + Anthropic 고급 검토',
    'settings.performanceQuality.qualityTranslation.modelOff': '표준 초안만',
    'settings.performanceQuality.qualityTranslation.reviewProvider':
      '검토 제공업체',
    'settings.performanceQuality.qualityTranslation.openAiHighEnd':
      'OpenAI 고급 검토',
    'settings.performanceQuality.qualityTranslation.anthropicHighEnd':
      'Anthropic 고급 검토',
    'settings.performanceQuality.qualitySummary.modelOn':
      'GPT-5.4 정밀 분석 + 하이라이트 클립',
    'settings.performanceQuality.qualitySummary.modelOff': 'GPT-5.1 기본 분석',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'ElevenLabs TTS 프리미엄 음성',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.byoPreferences.openAiHighEnd': 'OpenAI 고급 모델',
    'settings.byoPreferences.anthropicHighEnd': 'Anthropic 고급 모델',
    'settings.performanceQuality.rate.perHour': '시간당 약 {{credits}} 크레딧',
    'settings.performanceQuality.rate.perMinute': '분당 약 {{credits}} 크레딧',
    'settings.performanceQuality.rate.perSearch':
      '검색당 약 {{credits}} 크레딧',
    'settings.performanceQuality.rate.balance': '보유 크레딧: ~{{time}}',
  },
  mr: {
    'admin.title': 'प्रशासक',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'GPT-5.1 मसुदा + GPT-5.4 पुनरावलोकन',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'फक्त GPT-5.1 मसुदा',
    'settings.performanceQuality.qualitySummary.modelOn':
      'GPT-5.4 सखोल विश्लेषण + हायलाइट क्लिप्स',
    'settings.performanceQuality.qualitySummary.modelOff':
      'GPT-5.1 मानक विश्लेषण',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'ElevenLabs TTS प्रीमियम आवाज',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} क्रेडिट्स/तास',
    'settings.performanceQuality.rate.perMinute':
      '~{{credits}} क्रेडिट्स/मिनिट',
    'settings.performanceQuality.rate.perSearch': '~{{credits}} क्रेडिट्स/शोध',
    'settings.performanceQuality.rate.balance': 'शिल्लक: ~{{time}}',
  },
  ms: {
    'admin.title': 'Pentadbir',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'Draf GPT-5.1 + semakan GPT-5.4',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'Draf GPT-5.1 sahaja',
    'settings.performanceQuality.qualitySummary.modelOn':
      'Analisis mendalam GPT-5.4 + klip sorotan',
    'settings.performanceQuality.qualitySummary.modelOff':
      'Analisis standard GPT-5.1',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'Suara premium ElevenLabs TTS',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} kredit/jam',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} kredit/min',
    'settings.performanceQuality.rate.perSearch': '~{{credits}} kredit/carian',
    'settings.performanceQuality.rate.balance': 'Baki: ~{{time}}',
  },
  nl: {
    'admin.title': 'Beheerder',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'GPT-5.1-concept + GPT-5.4-review',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'Alleen GPT-5.1-concept',
    'settings.performanceQuality.qualitySummary.modelOn':
      'GPT-5.4-diepteanalyse + highlightclips',
    'settings.performanceQuality.qualitySummary.modelOff':
      'GPT-5.1-standaardanalyse',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'ElevenLabs TTS-premiumstemmen',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} credits/uur',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} credits/minuut',
    'settings.performanceQuality.rate.perSearch':
      '~{{credits}} credits/zoekopdracht',
    'settings.performanceQuality.rate.balance': 'Saldo: ~{{time}}',
  },
  no: {
    'admin.title': 'Administrator',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'GPT-5.1-utkast + GPT-5.4-gjennomgang',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'Kun GPT-5.1-utkast',
    'settings.performanceQuality.qualitySummary.modelOn':
      'GPT-5.4 dybdeanalyse + høydepunktklipp',
    'settings.performanceQuality.qualitySummary.modelOff':
      'GPT-5.1 standardanalyse',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'ElevenLabs TTS premiumstemmer',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} kreditter/time',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} kreditter/min',
    'settings.performanceQuality.rate.perSearch': '~{{credits}} kreditter/søk',
    'settings.performanceQuality.rate.balance': 'Saldo: ~{{time}}',
  },
  pl: {
    'admin.title': 'Administrator',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'Szkic GPT-5.1 + przegląd GPT-5.4',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'Tylko szkic GPT-5.1',
    'settings.performanceQuality.qualitySummary.modelOn':
      'Dogłębna analiza GPT-5.4 + klipy z wyróżnieniami',
    'settings.performanceQuality.qualitySummary.modelOff':
      'Standardowa analiza GPT-5.1',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'Głosy premium ElevenLabs TTS',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} kredytów/godz.',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} kredytów/min',
    'settings.performanceQuality.rate.perSearch':
      '~{{credits}} kredytów/wyszukiwanie',
    'settings.performanceQuality.rate.balance': 'Saldo: ~{{time}}',
  },
  pt: {
    'admin.title': 'Administrador',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'Rascunho GPT-5.1 + revisão GPT-5.4',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'Apenas rascunho GPT-5.1',
    'settings.performanceQuality.qualitySummary.modelOn':
      'Análise profunda GPT-5.4 + clipes em destaque',
    'settings.performanceQuality.qualitySummary.modelOff':
      'Análise padrão GPT-5.1',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'Vozes premium do ElevenLabs TTS',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} créditos/hora',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} créditos/min',
    'settings.performanceQuality.rate.perSearch':
      '~{{credits}} créditos/pesquisa',
    'settings.performanceQuality.rate.balance': 'Saldo: ~{{time}}',
  },
  ro: {
    'admin.title': 'Administrator',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'Schiță GPT-5.1 + revizuire GPT-5.4',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'Doar schiță GPT-5.1',
    'settings.performanceQuality.qualitySummary.modelOn':
      'Analiză profundă GPT-5.4 + clipuri highlight',
    'settings.performanceQuality.qualitySummary.modelOff':
      'Analiză standard GPT-5.1',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'Voci premium ElevenLabs TTS',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} credite/oră',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} credite/min',
    'settings.performanceQuality.rate.perSearch':
      '~{{credits}} credite/căutare',
    'settings.performanceQuality.rate.balance': 'Sold: ~{{time}}',
  },
  ru: {
    'admin.title': 'Администратор',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'Черновик GPT-5.1 + проверка GPT-5.4',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'Только черновик GPT-5.1',
    'settings.performanceQuality.qualitySummary.modelOn':
      'Глубокий анализ GPT-5.4 + клипы-хайлайты',
    'settings.performanceQuality.qualitySummary.modelOff':
      'Стандартный анализ GPT-5.1',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'Премиальные голоса ElevenLabs TTS',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} кредитов/час',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} кредитов/мин',
    'settings.performanceQuality.rate.perSearch': '~{{credits}} кредитов/поиск',
    'settings.performanceQuality.rate.balance': 'Баланс: ~{{time}}',
  },
  sv: {
    'admin.title': 'Administratör',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'GPT-5.1-utkast + GPT-5.4-granskning',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'Endast GPT-5.1-utkast',
    'settings.performanceQuality.qualitySummary.modelOn':
      'GPT-5.4 djupanalys + highlightklipp',
    'settings.performanceQuality.qualitySummary.modelOff':
      'GPT-5.1 standardanalys',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'ElevenLabs TTS-premiumröster',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} krediter/timme',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} krediter/min',
    'settings.performanceQuality.rate.perSearch':
      '~{{credits}} krediter/sökning',
    'settings.performanceQuality.rate.balance': 'Saldo: ~{{time}}',
  },
  sw: {
    'admin.title': 'Msimamizi',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'Rasimu ya GPT-5.1 + mapitio ya GPT-5.4',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'Rasimu ya GPT-5.1 pekee',
    'settings.performanceQuality.qualitySummary.modelOn':
      'Uchambuzi wa kina wa GPT-5.4 + klipu za vivutio',
    'settings.performanceQuality.qualitySummary.modelOff':
      'Uchambuzi wa kawaida wa GPT-5.1',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'Sauti za premium za ElevenLabs TTS',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} krediti/saa',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} krediti/dakika',
    'settings.performanceQuality.rate.perSearch':
      '~{{credits}} krediti/utafutaji',
    'settings.performanceQuality.rate.balance': 'Salio: ~{{time}}',
  },
  ta: {
    'admin.title': 'நிர்வாகி',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'GPT-5.1 வரைவு + GPT-5.4 மதிப்பாய்வு',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'GPT-5.1 வரைவு மட்டும்',
    'settings.performanceQuality.qualitySummary.modelOn':
      'GPT-5.4 ஆழமான பகுப்பாய்வு + ஹைலைட் கிளிப்புகள்',
    'settings.performanceQuality.qualitySummary.modelOff':
      'GPT-5.1 நிலையான பகுப்பாய்வு',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'ElevenLabs TTS பிரீமியம் குரல்கள்',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} கிரெடிட்கள்/மணி',
    'settings.performanceQuality.rate.perMinute':
      '~{{credits}} கிரெடிட்கள்/நிமிடம்',
    'settings.performanceQuality.rate.perSearch':
      '~{{credits}} கிரெடிட்கள்/தேடல்',
    'settings.performanceQuality.rate.balance': 'இருப்பு: ~{{time}}',
  },
  te: {
    'admin.title': 'నిర్వాహకుడు',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'GPT-5.1 డ్రాఫ్ట్ + GPT-5.4 సమీక్ష',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'GPT-5.1 డ్రాఫ్ట్ మాత్రమే',
    'settings.performanceQuality.qualitySummary.modelOn':
      'GPT-5.4 లోతైన విశ్లేషణ + హైలైట్ క్లిప్స్',
    'settings.performanceQuality.qualitySummary.modelOff':
      'GPT-5.1 ప్రమాణ విశ్లేషణ',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'ElevenLabs TTS ప్రీమియం వాయిసులు',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} క్రెడిట్‌లు/గంట',
    'settings.performanceQuality.rate.perMinute':
      '~{{credits}} క్రెడిట్‌లు/నిమిషం',
    'settings.performanceQuality.rate.perSearch':
      '~{{credits}} క్రెడిట్‌లు/శోధన',
    'settings.performanceQuality.rate.balance': 'బ్యాలెన్స్: ~{{time}}',
  },
  th: {
    'admin.title': 'ผู้ดูแลระบบ',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'GPT-5.1 ฉบับร่าง + GPT-5.4 รีวิว',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'GPT-5.1 ฉบับร่างเท่านั้น',
    'settings.performanceQuality.qualitySummary.modelOn':
      'GPT-5.4 วิเคราะห์เชิงลึก + คลิปไฮไลต์',
    'settings.performanceQuality.qualitySummary.modelOff':
      'GPT-5.1 วิเคราะห์มาตรฐาน',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'เสียงพรีเมียมของ ElevenLabs TTS',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} เครดิต/ชั่วโมง',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} เครดิต/นาที',
    'settings.performanceQuality.rate.perSearch':
      '~{{credits}} เครดิต/การค้นหา',
    'settings.performanceQuality.rate.balance': 'ยอดคงเหลือ: ~{{time}}',
  },
  tl: {
    'admin.title': 'Tagapangasiwa',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'Burador ng GPT-5.1 + rebyu ng GPT-5.4',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'Burador ng GPT-5.1 lang',
    'settings.performanceQuality.qualitySummary.modelOn':
      'Malalim na pagsusuri ng GPT-5.4 + mga highlight clip',
    'settings.performanceQuality.qualitySummary.modelOff':
      'Karaniwang pagsusuri ng GPT-5.1',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'Mga premium na boses ng ElevenLabs TTS',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} credit/oras',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} credit/min',
    'settings.performanceQuality.rate.perSearch':
      '~{{credits}} credit/paghahanap',
    'settings.performanceQuality.rate.balance': 'Balanse: ~{{time}}',
  },
  tr: {
    'admin.title': 'Yönetici',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'GPT-5.1 taslak + GPT-5.4 inceleme',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'Yalnızca GPT-5.1 taslak',
    'settings.performanceQuality.qualitySummary.modelOn':
      'GPT-5.4 derin analiz + öne çıkan klipler',
    'settings.performanceQuality.qualitySummary.modelOff':
      'GPT-5.1 standart analiz',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'ElevenLabs TTS premium sesler',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} kredi/saat',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} kredi/dk',
    'settings.performanceQuality.rate.perSearch': '~{{credits}} kredi/arama',
    'settings.performanceQuality.rate.balance': 'Bakiye: ~{{time}}',
  },
  uk: {
    'admin.title': 'Адміністратор',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'Чернетка GPT-5.1 + перевірка GPT-5.4',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'Лише чернетка GPT-5.1',
    'settings.performanceQuality.qualitySummary.modelOn':
      'Глибокий аналіз GPT-5.4 + кліпи-хайлайти',
    'settings.performanceQuality.qualitySummary.modelOff':
      'Стандартний аналіз GPT-5.1',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'Преміальні голоси ElevenLabs TTS',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} кредитів/год',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} кредитів/хв',
    'settings.performanceQuality.rate.perSearch': '~{{credits}} кредитів/пошук',
    'settings.performanceQuality.rate.balance': 'Баланс: ~{{time}}',
  },
  ur: {
    'admin.title': 'منتظم',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'GPT-5.1 مسودہ + GPT-5.4 جائزہ',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'صرف GPT-5.1 مسودہ',
    'settings.performanceQuality.qualitySummary.modelOn':
      'GPT-5.4 گہرا تجزیہ + ہائی لائٹ کلپس',
    'settings.performanceQuality.qualitySummary.modelOff':
      'GPT-5.1 معیاری تجزیہ',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'ElevenLabs TTS کی پریمیم آوازیں',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} کریڈٹس/گھنٹہ',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} کریڈٹس/منٹ',
    'settings.performanceQuality.rate.perSearch': '~{{credits}} کریڈٹس/تلاش',
    'settings.performanceQuality.rate.balance': 'بیلنس: ~{{time}}',
  },
  vi: {
    'admin.title': 'Quản trị viên',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'Bản nháp GPT-5.1 + rà soát GPT-5.4',
    'settings.performanceQuality.qualityTranslation.modelOff':
      'Chỉ bản nháp GPT-5.1',
    'settings.performanceQuality.qualitySummary.modelOn':
      'Phân tích sâu GPT-5.4 + clip nổi bật',
    'settings.performanceQuality.qualitySummary.modelOff':
      'Phân tích tiêu chuẩn GPT-5.1',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'Giọng premium ElevenLabs TTS',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} tín dụng/giờ',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} tín dụng/phút',
    'settings.performanceQuality.rate.perSearch':
      '~{{credits}} tín dụng/lượt tìm kiếm',
    'settings.performanceQuality.rate.balance': 'Số dư: ~{{time}}',
  },
  'zh-CN': {
    'admin.title': '管理员',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'GPT-5.1 草稿 + GPT-5.4 复审',
    'settings.performanceQuality.qualityTranslation.modelOff':
      '仅 GPT-5.1 草稿',
    'settings.performanceQuality.qualitySummary.modelOn':
      'GPT-5.4 深度分析 + 高亮片段',
    'settings.performanceQuality.qualitySummary.modelOff': 'GPT-5.1 标准分析',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'ElevenLabs TTS 高级音色',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} 积分/小时',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} 积分/分钟',
    'settings.performanceQuality.rate.perSearch': '~{{credits}} 积分/次搜索',
    'settings.performanceQuality.rate.balance': '余额：~{{time}}',
  },
  'zh-TW': {
    'admin.title': '管理員',
    'settings.performanceQuality.qualityTranslation.modelOn':
      'GPT-5.1 草稿 + GPT-5.4 複審',
    'settings.performanceQuality.qualityTranslation.modelOff':
      '僅 GPT-5.1 草稿',
    'settings.performanceQuality.qualitySummary.modelOn':
      'GPT-5.4 深度分析 + 精華片段',
    'settings.performanceQuality.qualitySummary.modelOff': 'GPT-5.1 標準分析',
    'settings.performanceQuality.qualityDubbing.modelOn':
      'ElevenLabs TTS 高級音色',
    'settings.performanceQuality.qualityDubbing.modelOff': 'OpenAI TTS',
    'settings.performanceQuality.rate.perHour': '~{{credits}} 點數/小時',
    'settings.performanceQuality.rate.perMinute': '~{{credits}} 點數/分鐘',
    'settings.performanceQuality.rate.perSearch': '~{{credits}} 點數/次搜尋',
    'settings.performanceQuality.rate.balance': '餘額：~{{time}}',
  },
};

const downloadFinishedOverrides = {
  af: {
    'input.downloadFinishedSwitchTitle': 'Afgelaaide video kyk?',
    'input.downloadFinishedSwitchPrompt':
      'Jou aflaai is gereed. Kyk dit nou, of hou jou huidige video en maak dit later uit die geskiedenis oop.',
    'input.downloadFinishedWatchNow': 'Kyk nou',
    'input.downloadFinishedWatchLater': 'Kyk later',
  },
  ar: {
    'input.downloadFinishedSwitchTitle': 'مشاهدة الفيديو الذي تم تنزيله؟',
    'input.downloadFinishedSwitchPrompt':
      'التنزيل جاهز. شاهده الآن، أو احتفظ بالفيديو الحالي وافتحه لاحقًا من السجل.',
    'input.downloadFinishedWatchNow': 'شاهد الآن',
    'input.downloadFinishedWatchLater': 'شاهد لاحقًا',
  },
  bn: {
    'input.downloadFinishedSwitchTitle': 'ডাউনলোড করা ভিডিও দেখবেন?',
    'input.downloadFinishedSwitchPrompt':
      'আপনার ডাউনলোড প্রস্তুত। এখনই দেখুন, অথবা বর্তমান ভিডিওটি রেখে পরে হিস্টরি থেকে খুলুন।',
    'input.downloadFinishedWatchNow': 'এখনই দেখুন',
    'input.downloadFinishedWatchLater': 'পরে দেখুন',
  },
  cs: {
    'input.downloadFinishedSwitchTitle': 'Přehrát stažené video?',
    'input.downloadFinishedSwitchPrompt':
      'Stažení je připravené. Přehrávat hned, nebo ponechat aktuální video a otevřít ho později z historie.',
    'input.downloadFinishedWatchNow': 'Přehrát teď',
    'input.downloadFinishedWatchLater': 'Přehrát později',
  },
  da: {
    'input.downloadFinishedSwitchTitle': 'Se den downloadede video?',
    'input.downloadFinishedSwitchPrompt':
      'Din download er klar. Se den nu, eller behold din nuværende video og åbn den senere fra historikken.',
    'input.downloadFinishedWatchNow': 'Se nu',
    'input.downloadFinishedWatchLater': 'Se senere',
  },
  de: {
    'input.downloadFinishedSwitchTitle': 'Heruntergeladenes Video ansehen?',
    'input.downloadFinishedSwitchPrompt':
      'Dein Download ist fertig. Sieh ihn dir jetzt an oder behalte dein aktuelles Video und öffne ihn später über den Verlauf.',
    'input.downloadFinishedWatchNow': 'Jetzt ansehen',
    'input.downloadFinishedWatchLater': 'Später ansehen',
  },
  el: {
    'input.downloadFinishedSwitchTitle': 'Να προβληθεί το βίντεο που κατέβηκε;',
    'input.downloadFinishedSwitchPrompt':
      'Η λήψη σου είναι έτοιμη. Δες το τώρα ή κράτησε το τρέχον βίντεο και άνοιξέ το αργότερα από το ιστορικό.',
    'input.downloadFinishedWatchNow': 'Δες τώρα',
    'input.downloadFinishedWatchLater': 'Δες αργότερα',
  },
  es: {
    'input.downloadFinishedSwitchTitle': '¿Ver el video descargado?',
    'input.downloadFinishedSwitchPrompt':
      'Tu descarga está lista. Míralo ahora o conserva tu video actual y ábrelo más tarde desde el historial.',
    'input.downloadFinishedWatchNow': 'Ver ahora',
    'input.downloadFinishedWatchLater': 'Ver más tarde',
  },
  fa: {
    'input.downloadFinishedSwitchTitle': 'ویدیوی دانلودشده را تماشا کنید؟',
    'input.downloadFinishedSwitchPrompt':
      'دانلود شما آماده است. همین حالا آن را تماشا کنید یا ویدیوی فعلی را نگه دارید و بعداً از تاریخچه بازش کنید.',
    'input.downloadFinishedWatchNow': 'همین حالا تماشا کن',
    'input.downloadFinishedWatchLater': 'بعداً تماشا کن',
  },
  fi: {
    'input.downloadFinishedSwitchTitle': 'Katsoa ladattu video?',
    'input.downloadFinishedSwitchPrompt':
      'Latauksesi on valmis. Katso se nyt tai pidä nykyinen videosi ja avaa se myöhemmin historiasta.',
    'input.downloadFinishedWatchNow': 'Katso nyt',
    'input.downloadFinishedWatchLater': 'Katso myöhemmin',
  },
  fr: {
    'input.downloadFinishedSwitchTitle': 'Regarder la vidéo téléchargée ?',
    'input.downloadFinishedSwitchPrompt':
      'Votre téléchargement est prêt. Regardez-le maintenant, ou gardez votre vidéo actuelle et ouvrez-le plus tard depuis l’historique.',
    'input.downloadFinishedWatchNow': 'Regarder maintenant',
    'input.downloadFinishedWatchLater': 'Regarder plus tard',
  },
  he: {
    'input.downloadFinishedSwitchTitle': 'לצפות בסרטון שהורד?',
    'input.downloadFinishedSwitchPrompt':
      'ההורדה שלך מוכנה. צפה בו עכשיו, או השאר את הסרטון הנוכחי ופתח אותו אחר כך מההיסטוריה.',
    'input.downloadFinishedWatchNow': 'צפה עכשיו',
    'input.downloadFinishedWatchLater': 'צפה אחר כך',
  },
  hi: {
    'input.downloadFinishedSwitchTitle': 'डाउनलोड किया गया वीडियो देखें?',
    'input.downloadFinishedSwitchPrompt':
      'आपका डाउनलोड तैयार है। इसे अभी देखें, या वर्तमान वीडियो को बनाए रखें और बाद में हिस्ट्री से खोलें।',
    'input.downloadFinishedWatchNow': 'अभी देखें',
    'input.downloadFinishedWatchLater': 'बाद में देखें',
  },
  hu: {
    'input.downloadFinishedSwitchTitle': 'Megnézed a letöltött videót?',
    'input.downloadFinishedSwitchPrompt':
      'A letöltés elkészült. Nézd meg most, vagy tartsd meg a jelenlegi videót, és nyisd meg később az előzményekből.',
    'input.downloadFinishedWatchNow': 'Megnézem most',
    'input.downloadFinishedWatchLater': 'Megnézem később',
  },
  id: {
    'input.downloadFinishedSwitchTitle': 'Tonton video yang diunduh?',
    'input.downloadFinishedSwitchPrompt':
      'Unduhan Anda sudah siap. Tonton sekarang, atau pertahankan video saat ini dan buka nanti dari riwayat.',
    'input.downloadFinishedWatchNow': 'Tonton sekarang',
    'input.downloadFinishedWatchLater': 'Tonton nanti',
  },
  it: {
    'input.downloadFinishedSwitchTitle': 'Guardare il video scaricato?',
    'input.downloadFinishedSwitchPrompt':
      'Il download è pronto. Guardalo ora oppure mantieni il video corrente e aprilo più tardi dalla cronologia.',
    'input.downloadFinishedWatchNow': 'Guarda ora',
    'input.downloadFinishedWatchLater': 'Guarda più tardi',
  },
  ja: {
    'input.downloadFinishedSwitchTitle': 'ダウンロードした動画を見ますか？',
    'input.downloadFinishedSwitchPrompt':
      'ダウンロードの準備ができました。今すぐ見るか、現在の動画をそのままにして後で履歴から開けます。',
    'input.downloadFinishedWatchNow': '今すぐ見る',
    'input.downloadFinishedWatchLater': '後で見る',
  },
  ko: {
    'input.downloadFinishedSwitchTitle': '다운로드한 영상을 볼까요?',
    'input.downloadFinishedSwitchPrompt':
      '다운로드가 준비되었습니다. 지금 보거나, 현재 영상을 유지한 채 나중에 기록에서 열 수 있습니다.',
    'input.downloadFinishedWatchNow': '지금 보기',
    'input.downloadFinishedWatchLater': '나중에 보기',
  },
  mr: {
    'input.downloadFinishedSwitchTitle': 'डाउनलोड केलेला व्हिडिओ पाहायचा?',
    'input.downloadFinishedSwitchPrompt':
      'तुमचे डाउनलोड तयार आहे. तो आत्ता पहा, किंवा सध्याचा व्हिडिओ तसाच ठेवून नंतर इतिहासातून उघडा.',
    'input.downloadFinishedWatchNow': 'आत्ता पहा',
    'input.downloadFinishedWatchLater': 'नंतर पहा',
  },
  ms: {
    'input.downloadFinishedSwitchTitle': 'Tonton video yang dimuat turun?',
    'input.downloadFinishedSwitchPrompt':
      'Muat turun anda sudah siap. Tontonnya sekarang, atau kekalkan video semasa anda dan bukanya kemudian dari sejarah.',
    'input.downloadFinishedWatchNow': 'Tonton sekarang',
    'input.downloadFinishedWatchLater': 'Tonton kemudian',
  },
  nl: {
    'input.downloadFinishedSwitchTitle': 'Gedownloade video bekijken?',
    'input.downloadFinishedSwitchPrompt':
      'Je download is klaar. Bekijk hem nu, of houd je huidige video aan en open hem later vanuit de geschiedenis.',
    'input.downloadFinishedWatchNow': 'Nu bekijken',
    'input.downloadFinishedWatchLater': 'Later bekijken',
  },
  no: {
    'input.downloadFinishedSwitchTitle': 'Se den nedlastede videoen?',
    'input.downloadFinishedSwitchPrompt':
      'Nedlastingen er klar. Se den nå, eller behold den nåværende videoen og åpne den senere fra historikken.',
    'input.downloadFinishedWatchNow': 'Se nå',
    'input.downloadFinishedWatchLater': 'Se senere',
  },
  pl: {
    'input.downloadFinishedSwitchTitle': 'Obejrzeć pobrany film?',
    'input.downloadFinishedSwitchPrompt':
      'Pobieranie jest gotowe. Obejrzyj go teraz albo zostaw bieżący film i otwórz go później z historii.',
    'input.downloadFinishedWatchNow': 'Obejrzyj teraz',
    'input.downloadFinishedWatchLater': 'Obejrzyj później',
  },
  pt: {
    'input.downloadFinishedSwitchTitle': 'Assistir ao vídeo baixado?',
    'input.downloadFinishedSwitchPrompt':
      'Seu download está pronto. Assista agora ou mantenha o vídeo atual e abra-o mais tarde pelo histórico.',
    'input.downloadFinishedWatchNow': 'Assistir agora',
    'input.downloadFinishedWatchLater': 'Assistir depois',
  },
  ro: {
    'input.downloadFinishedSwitchTitle': 'Vrei să vezi videoclipul descărcat?',
    'input.downloadFinishedSwitchPrompt':
      'Descărcarea este gata. Urmărește-l acum sau păstrează videoclipul curent și deschide-l mai târziu din istoric.',
    'input.downloadFinishedWatchNow': 'Urmărește acum',
    'input.downloadFinishedWatchLater': 'Urmărește mai târziu',
  },
  ru: {
    'input.downloadFinishedSwitchTitle': 'Посмотреть загруженное видео?',
    'input.downloadFinishedSwitchPrompt':
      'Загрузка готова. Посмотрите его сейчас или оставьте текущее видео и откройте его позже из истории.',
    'input.downloadFinishedWatchNow': 'Посмотреть сейчас',
    'input.downloadFinishedWatchLater': 'Посмотреть позже',
  },
  sv: {
    'input.downloadFinishedSwitchTitle': 'Titta på den nedladdade videon?',
    'input.downloadFinishedSwitchPrompt':
      'Din nedladdning är klar. Titta på den nu, eller behåll din nuvarande video och öppna den senare från historiken.',
    'input.downloadFinishedWatchNow': 'Titta nu',
    'input.downloadFinishedWatchLater': 'Titta senare',
  },
  sw: {
    'input.downloadFinishedSwitchTitle': 'Tazama video iliyopakuliwa?',
    'input.downloadFinishedSwitchPrompt':
      'Upakuaji wako uko tayari. Itazame sasa, au weka video yako ya sasa na uifungue baadaye kutoka kwenye historia.',
    'input.downloadFinishedWatchNow': 'Tazama sasa',
    'input.downloadFinishedWatchLater': 'Tazama baadaye',
  },
  ta: {
    'input.downloadFinishedSwitchTitle': 'பதிவிறக்கப்பட்ட வீடியோவை பார்க்கவா?',
    'input.downloadFinishedSwitchPrompt':
      'உங்கள் பதிவிறக்கம் தயார். அதை இப்போது பாருங்கள், அல்லது தற்போதைய வீடியோவை வைத்துக் கொண்டு பின்னர் வரலாற்றில் இருந்து திறக்கலாம்.',
    'input.downloadFinishedWatchNow': 'இப்போது பார்க்கவும்',
    'input.downloadFinishedWatchLater': 'பிறகு பார்க்கவும்',
  },
  te: {
    'input.downloadFinishedSwitchTitle': 'డౌన్‌లోడ్ చేసిన వీడియో చూడాలా?',
    'input.downloadFinishedSwitchPrompt':
      'మీ డౌన్‌లోడ్ సిద్ధంగా ఉంది. ఇప్పుడే చూడండి, లేదా ప్రస్తుత వీడియోను అలాగే ఉంచి తర్వాత హిస్టరీ నుంచి తెరవండి.',
    'input.downloadFinishedWatchNow': 'ఇప్పుడే చూడండి',
    'input.downloadFinishedWatchLater': 'తర్వాత చూడండి',
  },
  th: {
    'input.downloadFinishedSwitchTitle': 'ดูวิดีโอที่ดาวน์โหลดแล้วไหม?',
    'input.downloadFinishedSwitchPrompt':
      'ดาวน์โหลดของคุณพร้อมแล้ว ดูตอนนี้ได้เลย หรือคงวิดีโอปัจจุบันไว้แล้วค่อยเปิดจากประวัติภายหลัง',
    'input.downloadFinishedWatchNow': 'ดูตอนนี้',
    'input.downloadFinishedWatchLater': 'ดูภายหลัง',
  },
  tl: {
    'input.downloadFinishedSwitchTitle': 'Panoorin ang na-download na video?',
    'input.downloadFinishedSwitchPrompt':
      'Handa na ang download mo. Panoorin ito ngayon, o panatilihin ang kasalukuyan mong video at buksan ito mamaya mula sa history.',
    'input.downloadFinishedWatchNow': 'Panoorin ngayon',
    'input.downloadFinishedWatchLater': 'Panoorin mamaya',
  },
  tr: {
    'input.downloadFinishedSwitchTitle': 'İndirilen video izlensin mi?',
    'input.downloadFinishedSwitchPrompt':
      'İndirmeniz hazır. Şimdi izleyin ya da mevcut videonuzu koruyup daha sonra geçmişten açın.',
    'input.downloadFinishedWatchNow': 'Şimdi izle',
    'input.downloadFinishedWatchLater': 'Daha sonra izle',
  },
  uk: {
    'input.downloadFinishedSwitchTitle': 'Переглянути завантажене відео?',
    'input.downloadFinishedSwitchPrompt':
      'Завантаження готове. Перегляньте його зараз або залиште поточне відео й відкрийте його пізніше з історії.',
    'input.downloadFinishedWatchNow': 'Переглянути зараз',
    'input.downloadFinishedWatchLater': 'Переглянути пізніше',
  },
  ur: {
    'input.downloadFinishedSwitchTitle': 'ڈاؤن لوڈ کی گئی ویڈیو دیکھیں؟',
    'input.downloadFinishedSwitchPrompt':
      'آپ کا ڈاؤن لوڈ تیار ہے۔ اسے ابھی دیکھیں، یا موجودہ ویڈیو برقرار رکھیں اور بعد میں ہسٹری سے کھولیں۔',
    'input.downloadFinishedWatchNow': 'ابھی دیکھیں',
    'input.downloadFinishedWatchLater': 'بعد میں دیکھیں',
  },
  vi: {
    'input.downloadFinishedSwitchTitle': 'Xem video đã tải xuống?',
    'input.downloadFinishedSwitchPrompt':
      'Bản tải xuống của bạn đã sẵn sàng. Xem ngay hoặc giữ video hiện tại và mở lại sau từ lịch sử.',
    'input.downloadFinishedWatchNow': 'Xem ngay',
    'input.downloadFinishedWatchLater': 'Xem sau',
  },
  'zh-CN': {
    'input.downloadFinishedSwitchTitle': '观看已下载的视频？',
    'input.downloadFinishedSwitchPrompt':
      '你的下载已准备好。现在观看，或保留当前视频，稍后再从历史记录中打开。',
    'input.downloadFinishedWatchNow': '现在观看',
    'input.downloadFinishedWatchLater': '稍后观看',
  },
  'zh-TW': {
    'input.downloadFinishedSwitchTitle': '觀看已下載的影片？',
    'input.downloadFinishedSwitchPrompt':
      '你的下載已準備好。現在觀看，或保留目前的影片，稍後再從歷史記錄開啟。',
    'input.downloadFinishedWatchNow': '立即觀看',
    'input.downloadFinishedWatchLater': '稍後觀看',
  },
};

const videoSuggestionFollowUpOverrides = {
  af: {
    'input.videoSuggestion.showFollowUps': 'Voorgestelde opvolgidees',
    'input.videoSuggestion.hideFollowUps': 'Versteek opvolgidees',
    'input.videoSuggestion.followUpChooserLabel':
      "Kies 'n beginpunt en wysig dit as jy wil.",
    'input.videoSuggestion.followUp.moreLikeQuery':
      'Vind meer video\'s soos "{{query}}"',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" van \'n ander skepper of kanaal',
    'input.videoSuggestion.followUp.interviews':
      'Onderhoude of gesprekke oor {{query}}',
    'input.videoSuggestion.followUp.clips':
      'Hoogtepunte of uitstaande snitte van {{query}}',
    'input.videoSuggestion.followUp.creatorAppearances':
      '{{creator}}-onderhoude, TV-verskynings of regstreekse snitte',
    'input.videoSuggestion.followUp.similarCreators':
      'Skeppers of kunstenaars soortgelyk aan {{creator}}',
    'input.videoSuggestion.followUp.topicAngle':
      "{{topic}} uit 'n ander hoek verduidelik",
    'input.videoSuggestion.followUp.topicCreator':
      "{{creator}} en verwante {{topic}}-video's",
    'input.videoSuggestion.followUp.channelStyle':
      "Video's met 'n soortgelyke gevoel as {{channel}}",
  },
  ar: {
    'input.videoSuggestion.showFollowUps': 'اقتراحات متابعة',
    'input.videoSuggestion.hideFollowUps': 'إخفاء اقتراحات المتابعة',
    'input.videoSuggestion.followUpChooserLabel':
      'اختر نقطة بداية، ثم عدّلها إذا أردت.',
    'input.videoSuggestion.followUp.moreLikeQuery':
      'اعثر على المزيد من الفيديوهات المشابهة لـ "{{query}}"',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" من صانع محتوى أو قناة أخرى',
    'input.videoSuggestion.followUp.interviews':
      'مقابلات أو حوارات حول {{query}}',
    'input.videoSuggestion.followUp.clips':
      'أبرز اللقطات أو المقاطع المميزة حول {{query}}',
    'input.videoSuggestion.followUp.creatorAppearances':
      'مقابلات {{creator}} أو ظهوره التلفزيوني أو مقاطع مباشرة',
    'input.videoSuggestion.followUp.similarCreators':
      'صناع محتوى أو فنانون مشابهون لـ {{creator}}',
    'input.videoSuggestion.followUp.topicAngle':
      'شرح {{topic}} من زاوية مختلفة',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} وفيديوهات مرتبطة بـ {{topic}}',
    'input.videoSuggestion.followUp.channelStyle':
      'فيديوهات بإحساس مشابه لـ {{channel}}',
  },
  bn: {
    'input.videoSuggestion.showFollowUps': 'পরবর্তী প্রস্তাবনা',
    'input.videoSuggestion.hideFollowUps': 'পরবর্তী প্রস্তাবনা লুকান',
    'input.videoSuggestion.followUpChooserLabel':
      'একটি শুরুর দিক বেছে নিন, তারপর চাইলে সেটি সম্পাদনা করুন।',
    'input.videoSuggestion.followUp.moreLikeQuery':
      '"{{query}}"-এর মতো আরও ভিডিও খুঁজুন',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" অন্য কোনো নির্মাতা বা চ্যানেল থেকে',
    'input.videoSuggestion.followUp.interviews':
      '{{query}} নিয়ে সাক্ষাৎকার বা আলাপ',
    'input.videoSuggestion.followUp.clips':
      '{{query}}-এর হাইলাইট বা উল্লেখযোগ্য ক্লিপ',
    'input.videoSuggestion.followUp.creatorAppearances':
      '{{creator}}-এর সাক্ষাৎকার, টিভি উপস্থিতি বা লাইভ ক্লিপ',
    'input.videoSuggestion.followUp.similarCreators':
      '{{creator}}-এর মতো নির্মাতা বা শিল্পী',
    'input.videoSuggestion.followUp.topicAngle':
      '{{topic}} অন্য দৃষ্টিকোণ থেকে ব্যাখ্যা করা',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} এবং {{topic}}-সম্পর্কিত ভিডিও',
    'input.videoSuggestion.followUp.channelStyle':
      '{{channel}}-এর মতো অনুভূতির ভিডিও',
  },
  cs: {
    'input.videoSuggestion.showFollowUps': 'Navrhovaná pokračování',
    'input.videoSuggestion.hideFollowUps': 'Skrýt pokračování',
    'input.videoSuggestion.followUpChooserLabel':
      'Vyber výchozí bod a uprav ho, pokud chceš.',
    'input.videoSuggestion.followUp.moreLikeQuery':
      'Najít další videa jako "{{query}}"',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" od jiného tvůrce nebo kanálu',
    'input.videoSuggestion.followUp.interviews':
      'Rozhovory nebo interview o {{query}}',
    'input.videoSuggestion.followUp.clips':
      'Nejzajímavější momenty nebo výrazné klipy o {{query}}',
    'input.videoSuggestion.followUp.creatorAppearances':
      'Rozhovory, TV vystoupení nebo živé klipy s {{creator}}',
    'input.videoSuggestion.followUp.similarCreators':
      'Tvůrci nebo umělci podobní {{creator}}',
    'input.videoSuggestion.followUp.topicAngle':
      '{{topic}} vysvětlené z jiného úhlu',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} a související videa o {{topic}}',
    'input.videoSuggestion.followUp.channelStyle':
      'Videa s podobnou atmosférou jako {{channel}}',
  },
  da: {
    'input.videoSuggestion.showFollowUps': 'Foreslåede opfølgninger',
    'input.videoSuggestion.hideFollowUps': 'Skjul opfølgninger',
    'input.videoSuggestion.followUpChooserLabel':
      'Vælg et udgangspunkt, og redigér det, hvis du vil.',
    'input.videoSuggestion.followUp.moreLikeQuery':
      'Find flere videoer som "{{query}}"',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" fra en anden skaber eller kanal',
    'input.videoSuggestion.followUp.interviews':
      'Interviews eller samtaler om {{query}}',
    'input.videoSuggestion.followUp.clips':
      'Højdepunkter eller markante klip om {{query}}',
    'input.videoSuggestion.followUp.creatorAppearances':
      'Interviews, tv-optrædener eller liveklip med {{creator}}',
    'input.videoSuggestion.followUp.similarCreators':
      'Skabere eller kunstnere, der minder om {{creator}}',
    'input.videoSuggestion.followUp.topicAngle':
      '{{topic}} forklaret fra en anden vinkel',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} og relaterede videoer om {{topic}}',
    'input.videoSuggestion.followUp.channelStyle':
      'Videoer med en lignende stemning som {{channel}}',
  },
  de: {
    'input.videoSuggestion.showFollowUps': 'Vorgeschlagene Anschlussideen',
    'input.videoSuggestion.hideFollowUps': 'Anschlussideen ausblenden',
    'input.videoSuggestion.followUpChooserLabel':
      'Wähle einen Einstieg und passe ihn bei Bedarf an.',
    'input.videoSuggestion.followUp.moreLikeQuery':
      'Finde mehr Videos wie "{{query}}"',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" von einem anderen Creator oder Kanal',
    'input.videoSuggestion.followUp.interviews':
      'Interviews oder Gespräche zu {{query}}',
    'input.videoSuggestion.followUp.clips':
      'Highlights oder starke Clips zu {{query}}',
    'input.videoSuggestion.followUp.creatorAppearances':
      'Interviews, TV-Auftritte oder Live-Clips von {{creator}}',
    'input.videoSuggestion.followUp.similarCreators':
      'Creator oder Künstler ähnlich wie {{creator}}',
    'input.videoSuggestion.followUp.topicAngle':
      '{{topic}} aus einem anderen Blickwinkel erklärt',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} und verwandte Videos zu {{topic}}',
    'input.videoSuggestion.followUp.channelStyle':
      'Videos mit einer ähnlichen Stimmung wie bei {{channel}}',
  },
  el: {
    'input.videoSuggestion.showFollowUps': 'Προτεινόμενες συνέχειες',
    'input.videoSuggestion.hideFollowUps': 'Απόκρυψη συνεχειών',
    'input.videoSuggestion.followUpChooserLabel':
      'Διάλεξε ένα σημείο εκκίνησης και επεξεργάσου το αν θέλεις.',
    'input.videoSuggestion.followUp.moreLikeQuery':
      'Βρες περισσότερα βίντεο σαν το "{{query}}"',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" από άλλον δημιουργό ή κανάλι',
    'input.videoSuggestion.followUp.interviews':
      'Συνεντεύξεις ή συζητήσεις για {{query}}',
    'input.videoSuggestion.followUp.clips':
      'Κορυφαίες στιγμές ή ξεχωριστά αποσπάσματα για {{query}}',
    'input.videoSuggestion.followUp.creatorAppearances':
      'Συνεντεύξεις, τηλεοπτικές εμφανίσεις ή live αποσπάσματα του {{creator}}',
    'input.videoSuggestion.followUp.similarCreators':
      'Δημιουργοί ή καλλιτέχνες παρόμοιοι με τον/την {{creator}}',
    'input.videoSuggestion.followUp.topicAngle':
      'Το {{topic}} εξηγημένο από άλλη οπτική',
    'input.videoSuggestion.followUp.topicCreator':
      'Ο/Η {{creator}} και σχετικά βίντεο για {{topic}}',
    'input.videoSuggestion.followUp.channelStyle':
      'Βίντεο με παρόμοια αίσθηση με το {{channel}}',
  },
  es: {
    'input.videoSuggestion.showFollowUps': 'Sugerencias de seguimiento',
    'input.videoSuggestion.hideFollowUps': 'Ocultar sugerencias',
    'input.videoSuggestion.followUpChooserLabel':
      'Elige un punto de partida y edítalo si quieres.',
    'input.videoSuggestion.followUp.moreLikeQuery':
      'Encuentra más videos como "{{query}}"',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" de otro creador o canal',
    'input.videoSuggestion.followUp.interviews':
      'Entrevistas o conversaciones sobre {{query}}',
    'input.videoSuggestion.followUp.clips':
      'Lo mejor o clips destacados de {{query}}',
    'input.videoSuggestion.followUp.creatorAppearances':
      'Entrevistas, apariciones en TV o clips en vivo de {{creator}}',
    'input.videoSuggestion.followUp.similarCreators':
      'Creadores o artistas parecidos a {{creator}}',
    'input.videoSuggestion.followUp.topicAngle':
      '{{topic}} explicado desde otro ángulo',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} y videos relacionados con {{topic}}',
    'input.videoSuggestion.followUp.channelStyle':
      'Videos con un estilo parecido a {{channel}}',
  },
  fa: {
    'input.videoSuggestion.showFollowUps': 'پیشنهادهای ادامه',
    'input.videoSuggestion.hideFollowUps': 'پنهان کردن پیشنهادهای ادامه',
    'input.videoSuggestion.followUpChooserLabel':
      'یک نقطه شروع انتخاب کنید و اگر خواستید آن را ویرایش کنید.',
    'input.videoSuggestion.followUp.moreLikeQuery':
      'ویدیوهای بیشتری شبیه "{{query}}" پیدا کن',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" از یک سازنده یا کانال دیگر',
    'input.videoSuggestion.followUp.interviews':
      'مصاحبه‌ها یا گفتگوهای دربارهٔ {{query}}',
    'input.videoSuggestion.followUp.clips':
      'بخش‌های برجسته یا کلیپ‌های شاخص از {{query}}',
    'input.videoSuggestion.followUp.creatorAppearances':
      'مصاحبه‌ها، حضورهای تلویزیونی یا کلیپ‌های زندهٔ {{creator}}',
    'input.videoSuggestion.followUp.similarCreators':
      'سازندگان یا هنرمندان شبیه {{creator}}',
    'input.videoSuggestion.followUp.topicAngle':
      '{{topic}} از زاویه‌ای دیگر توضیح داده شده',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} و ویدیوهای مرتبط با {{topic}}',
    'input.videoSuggestion.followUp.channelStyle':
      'ویدیوهایی با حال‌وهوایی شبیه {{channel}}',
  },
  fi: {
    'input.videoSuggestion.showFollowUps': 'Ehdotetut jatkoideat',
    'input.videoSuggestion.hideFollowUps': 'Piilota jatkoideat',
    'input.videoSuggestion.followUpChooserLabel':
      'Valitse lähtökohta ja muokkaa sitä halutessasi.',
    'input.videoSuggestion.followUp.moreLikeQuery':
      'Löydä lisää videoita kuten "{{query}}"',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" toiselta tekijältä tai kanavalta',
    'input.videoSuggestion.followUp.interviews':
      '{{query}}-haastatteluja tai keskusteluja',
    'input.videoSuggestion.followUp.clips':
      '{{query}}-kohokohtia tai erottuvia klippejä',
    'input.videoSuggestion.followUp.creatorAppearances':
      '{{creator}}-haastatteluja, TV-esiintymisiä tai liveklippejä',
    'input.videoSuggestion.followUp.similarCreators':
      '{{creator}}-tyyppisiä tekijöitä tai artisteja',
    'input.videoSuggestion.followUp.topicAngle':
      '{{topic}} selitettynä toisesta näkökulmasta',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} ja siihen liittyvät {{topic}}-videot',
    'input.videoSuggestion.followUp.channelStyle':
      'Videoita, joissa on samanlainen tunnelma kuin {{channel}}ssa',
  },
  fr: {
    'input.videoSuggestion.showFollowUps': 'Suggestions de suite',
    'input.videoSuggestion.hideFollowUps': 'Masquer les suggestions',
    'input.videoSuggestion.followUpChooserLabel':
      'Choisissez un point de départ, puis modifiez-le si vous voulez.',
    'input.videoSuggestion.followUp.moreLikeQuery':
      'Trouvez plus de vidéos comme "{{query}}"',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" par un autre créateur ou une autre chaîne',
    'input.videoSuggestion.followUp.interviews':
      'Interviews ou conversations sur {{query}}',
    'input.videoSuggestion.followUp.clips':
      'Extraits marquants ou meilleurs moments de {{query}}',
    'input.videoSuggestion.followUp.creatorAppearances':
      'Interviews, passages TV ou clips live de {{creator}}',
    'input.videoSuggestion.followUp.similarCreators':
      'Créateurs ou artistes similaires à {{creator}}',
    'input.videoSuggestion.followUp.topicAngle':
      '{{topic}} expliqué sous un autre angle',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} et vidéos liées à {{topic}}',
    'input.videoSuggestion.followUp.channelStyle':
      'Des vidéos dans un style proche de {{channel}}',
  },
  he: {
    'input.videoSuggestion.showFollowUps': 'הצעות המשך',
    'input.videoSuggestion.hideFollowUps': 'הסתר הצעות המשך',
    'input.videoSuggestion.followUpChooserLabel':
      'בחר נקודת פתיחה ואז ערוך אותה אם תרצה.',
    'input.videoSuggestion.followUp.moreLikeQuery':
      'מצא עוד סרטונים כמו "{{query}}"',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" מיוצר אחר או ערוץ אחר',
    'input.videoSuggestion.followUp.interviews':
      'ראיונות או שיחות על {{query}}',
    'input.videoSuggestion.followUp.clips':
      'תקצירי שיא או קליפים בולטים של {{query}}',
    'input.videoSuggestion.followUp.creatorAppearances':
      'ראיונות, הופעות טלוויזיה או קליפים חיים של {{creator}}',
    'input.videoSuggestion.followUp.similarCreators':
      'יוצרים או אמנים דומים ל-{{creator}}',
    'input.videoSuggestion.followUp.topicAngle': '{{topic}} מוסבר מזווית אחרת',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} וסרטונים קשורים על {{topic}}',
    'input.videoSuggestion.followUp.channelStyle':
      'סרטונים עם תחושה דומה ל-{{channel}}',
  },
  hi: {
    'input.videoSuggestion.showFollowUps': 'आगे के सुझाए गए आइडिया',
    'input.videoSuggestion.hideFollowUps': 'आगे के आइडिया छिपाएं',
    'input.videoSuggestion.followUpChooserLabel':
      'एक शुरुआती बिंदु चुनें, फिर चाहें तो उसे संपादित करें।',
    'input.videoSuggestion.followUp.moreLikeQuery':
      '"{{query}}" जैसे और वीडियो ढूंढें',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" किसी दूसरे क्रिएटर या चैनल से',
    'input.videoSuggestion.followUp.interviews':
      '{{query}} पर इंटरव्यू या बातचीत',
    'input.videoSuggestion.followUp.clips':
      '{{query}} के हाइलाइट्स या खास क्लिप',
    'input.videoSuggestion.followUp.creatorAppearances':
      '{{creator}} के इंटरव्यू, टीवी उपस्थितियां या लाइव क्लिप',
    'input.videoSuggestion.followUp.similarCreators':
      '{{creator}} जैसे क्रिएटर या कलाकार',
    'input.videoSuggestion.followUp.topicAngle':
      '{{topic}} को एक अलग नजरिए से समझाया गया',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} और {{topic}} से जुड़े वीडियो',
    'input.videoSuggestion.followUp.channelStyle':
      '{{channel}} जैसी फील वाले वीडियो',
  },
  hu: {
    'input.videoSuggestion.showFollowUps': 'Javasolt folytatások',
    'input.videoSuggestion.hideFollowUps': 'Folytatások elrejtése',
    'input.videoSuggestion.followUpChooserLabel':
      'Válassz egy kiindulópontot, és szerkeszd át, ha akarod.',
    'input.videoSuggestion.followUp.moreLikeQuery':
      'Keress több videót ehhez: "{{query}}"',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" másik alkotótól vagy csatornától',
    'input.videoSuggestion.followUp.interviews':
      'Interjúk vagy beszélgetések {{query}} témában',
    'input.videoSuggestion.followUp.clips':
      '{{query}} kiemelt részei vagy emlékezetes klipjei',
    'input.videoSuggestion.followUp.creatorAppearances':
      '{{creator}} interjúk, tévés szereplések vagy élő klipek',
    'input.videoSuggestion.followUp.similarCreators':
      '{{creator}}-hoz hasonló alkotók vagy előadók',
    'input.videoSuggestion.followUp.topicAngle':
      '{{topic}} más nézőpontból elmagyarázva',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} és kapcsolódó {{topic}} videók',
    'input.videoSuggestion.followUp.channelStyle':
      'A {{channel}} hangulatához hasonló videók',
  },
  id: {
    'input.videoSuggestion.showFollowUps': 'Saran lanjutan',
    'input.videoSuggestion.hideFollowUps': 'Sembunyikan saran lanjutan',
    'input.videoSuggestion.followUpChooserLabel':
      'Pilih titik awal, lalu edit jika mau.',
    'input.videoSuggestion.followUp.moreLikeQuery':
      'Temukan lebih banyak video seperti "{{query}}"',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" dari kreator atau channel lain',
    'input.videoSuggestion.followUp.interviews':
      'Wawancara atau percakapan tentang {{query}}',
    'input.videoSuggestion.followUp.clips':
      'Sorotan atau klip menonjol dari {{query}}',
    'input.videoSuggestion.followUp.creatorAppearances':
      'Wawancara, penampilan TV, atau klip live dari {{creator}}',
    'input.videoSuggestion.followUp.similarCreators':
      'Kreator atau artis yang mirip dengan {{creator}}',
    'input.videoSuggestion.followUp.topicAngle':
      '{{topic}} dijelaskan dari sudut pandang lain',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} dan video terkait {{topic}}',
    'input.videoSuggestion.followUp.channelStyle':
      'Video dengan nuansa mirip {{channel}}',
  },
  it: {
    'input.videoSuggestion.showFollowUps': 'Suggerimenti successivi',
    'input.videoSuggestion.hideFollowUps': 'Nascondi suggerimenti',
    'input.videoSuggestion.followUpChooserLabel':
      'Scegli un punto di partenza e modificalo se vuoi.',
    'input.videoSuggestion.followUp.moreLikeQuery':
      'Trova altri video come "{{query}}"',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" da un altro creator o canale',
    'input.videoSuggestion.followUp.interviews':
      'Interviste o conversazioni su {{query}}',
    'input.videoSuggestion.followUp.clips':
      'Momenti salienti o clip notevoli di {{query}}',
    'input.videoSuggestion.followUp.creatorAppearances':
      'Interviste, apparizioni TV o clip dal vivo di {{creator}}',
    'input.videoSuggestion.followUp.similarCreators':
      'Creator o artisti simili a {{creator}}',
    'input.videoSuggestion.followUp.topicAngle':
      "{{topic}} spiegato da un'altra prospettiva",
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} e video correlati a {{topic}}',
    'input.videoSuggestion.followUp.channelStyle':
      "Video con un'atmosfera simile a quella di {{channel}}",
  },
  ja: {
    'input.videoSuggestion.useLastSearch': '前回の設定を使う',
    'input.videoSuggestion.showFollowUps': 'おすすめの続き',
    'input.videoSuggestion.hideFollowUps': '続きの候補を隠す',
    'input.videoSuggestion.followUpChooserLabel':
      '出発点を選んで、必要なら編集してください。',
    'input.videoSuggestion.followUp.moreLikeQuery':
      '"{{query}}" のような動画をもっと探す',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" を別のクリエイターやチャンネルで探す',
    'input.videoSuggestion.followUp.interviews':
      '{{query}} のインタビューや対談',
    'input.videoSuggestion.followUp.clips':
      '{{query}} のハイライトや注目クリップ',
    'input.videoSuggestion.followUp.creatorAppearances':
      '{{creator}} のインタビュー、テレビ出演、ライブクリップ',
    'input.videoSuggestion.followUp.similarCreators':
      '{{creator}} に近いクリエイターやアーティスト',
    'input.videoSuggestion.followUp.topicAngle':
      '{{topic}} を別の切り口で解説した動画',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} と関連する {{topic}} 動画',
    'input.videoSuggestion.followUp.channelStyle':
      '{{channel}} に近い雰囲気の動画',
  },
  ko: {
    'input.videoSuggestion.useLastSearch': '지난 설정 사용',
    'input.videoSuggestion.showFollowUps': '추천 후속 검색',
    'input.videoSuggestion.hideFollowUps': '후속 검색 숨기기',
    'input.videoSuggestion.followUpChooserLabel':
      '시작점 하나를 고른 뒤, 원하면 내용을 다듬어 보세요.',
    'input.videoSuggestion.followUp.moreLikeQuery':
      '"{{query}}"와 비슷한 영상을 더 찾아보기',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}"를 다른 크리에이터나 채널로 찾아보기',
    'input.videoSuggestion.followUp.interviews': '{{query}} 관련 인터뷰나 대화',
    'input.videoSuggestion.followUp.clips':
      '{{query}} 하이라이트나 눈에 띄는 클립',
    'input.videoSuggestion.followUp.creatorAppearances':
      '{{creator}} 인터뷰, TV 출연, 라이브 클립',
    'input.videoSuggestion.followUp.similarCreators':
      '{{creator}}와 비슷한 크리에이터나 아티스트',
    'input.videoSuggestion.followUp.topicAngle':
      '{{topic}}를 다른 관점으로 설명한 영상',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}}와 관련된 {{topic}} 영상',
    'input.videoSuggestion.followUp.channelStyle':
      '{{channel}}와 비슷한 분위기의 영상',
  },
  mr: {
    'input.videoSuggestion.showFollowUps': 'पुढील सुचवलेले पर्याय',
    'input.videoSuggestion.hideFollowUps': 'पुढील पर्याय लपवा',
    'input.videoSuggestion.followUpChooserLabel':
      'एक सुरुवातीचा पर्याय निवडा, मग हवे असल्यास तो संपादा.',
    'input.videoSuggestion.followUp.moreLikeQuery':
      '"{{query}}" सारखे आणखी व्हिडिओ शोधा',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" दुसऱ्या क्रिएटर किंवा चॅनेलकडून',
    'input.videoSuggestion.followUp.interviews':
      '{{query}} वर मुलाखती किंवा संभाषणे',
    'input.videoSuggestion.followUp.clips':
      '{{query}} चे हायलाइट्स किंवा उठून दिसणारे क्लिप्स',
    'input.videoSuggestion.followUp.creatorAppearances':
      '{{creator}} च्या मुलाखती, टीव्ही उपस्थिती किंवा लाईव्ह क्लिप्स',
    'input.videoSuggestion.followUp.similarCreators':
      '{{creator}} सारखे क्रिएटर किंवा कलाकार',
    'input.videoSuggestion.followUp.topicAngle':
      '{{topic}} वेगळ्या दृष्टिकोनातून समजावलेले',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} आणि {{topic}} संदर्भातील व्हिडिओ',
    'input.videoSuggestion.followUp.channelStyle':
      '{{channel}} सारखी भावना असलेले व्हिडिओ',
  },
  ms: {
    'input.videoSuggestion.showFollowUps': 'Cadangan susulan',
    'input.videoSuggestion.hideFollowUps': 'Sembunyikan cadangan susulan',
    'input.videoSuggestion.followUpChooserLabel':
      'Pilih titik permulaan, kemudian edit jika mahu.',
    'input.videoSuggestion.followUp.moreLikeQuery':
      'Cari lebih banyak video seperti "{{query}}"',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" daripada pencipta atau saluran lain',
    'input.videoSuggestion.followUp.interviews':
      'Temu bual atau perbualan tentang {{query}}',
    'input.videoSuggestion.followUp.clips':
      'Sorotan atau klip menonjol tentang {{query}}',
    'input.videoSuggestion.followUp.creatorAppearances':
      'Temu bual, penampilan TV atau klip langsung {{creator}}',
    'input.videoSuggestion.followUp.similarCreators':
      'Pencipta atau artis yang serupa dengan {{creator}}',
    'input.videoSuggestion.followUp.topicAngle':
      '{{topic}} diterangkan dari sudut lain',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} dan video berkaitan {{topic}}',
    'input.videoSuggestion.followUp.channelStyle':
      'Video dengan suasana serupa seperti {{channel}}',
  },
  nl: {
    'input.videoSuggestion.showFollowUps': 'Vervolgideeën',
    'input.videoSuggestion.hideFollowUps': 'Vervolgideeën verbergen',
    'input.videoSuggestion.followUpChooserLabel':
      'Kies een startpunt en pas het aan als je wilt.',
    'input.videoSuggestion.followUp.moreLikeQuery':
      'Vind meer video\'s zoals "{{query}}"',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" van een andere maker of kanaal',
    'input.videoSuggestion.followUp.interviews':
      'Interviews of gesprekken over {{query}}',
    'input.videoSuggestion.followUp.clips':
      'Highlights of opvallende clips van {{query}}',
    'input.videoSuggestion.followUp.creatorAppearances':
      'Interviews, tv-optredens of liveclips van {{creator}}',
    'input.videoSuggestion.followUp.similarCreators':
      'Makers of artiesten vergelijkbaar met {{creator}}',
    'input.videoSuggestion.followUp.topicAngle':
      '{{topic}} vanuit een andere invalshoek uitgelegd',
    'input.videoSuggestion.followUp.topicCreator':
      "{{creator}} en gerelateerde video's over {{topic}}",
    'input.videoSuggestion.followUp.channelStyle':
      "Video's met een vergelijkbare sfeer als {{channel}}",
  },
  no: {
    'input.videoSuggestion.showFollowUps': 'Foreslåtte oppfølgingsideer',
    'input.videoSuggestion.hideFollowUps': 'Skjul oppfølgingsideer',
    'input.videoSuggestion.followUpChooserLabel':
      'Velg et utgangspunkt og rediger det hvis du vil.',
    'input.videoSuggestion.followUp.moreLikeQuery':
      'Finn flere videoer som "{{query}}"',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" fra en annen skaper eller kanal',
    'input.videoSuggestion.followUp.interviews':
      'Intervjuer eller samtaler om {{query}}',
    'input.videoSuggestion.followUp.clips':
      'Høydepunkter eller sterke klipp om {{query}}',
    'input.videoSuggestion.followUp.creatorAppearances':
      'Intervjuer, TV-opptredener eller liveklipp med {{creator}}',
    'input.videoSuggestion.followUp.similarCreators':
      'Skapere eller artister som ligner på {{creator}}',
    'input.videoSuggestion.followUp.topicAngle':
      '{{topic}} forklart fra en annen vinkel',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} og relaterte videoer om {{topic}}',
    'input.videoSuggestion.followUp.channelStyle':
      'Videoer med en lignende stemning som {{channel}}',
  },
  pl: {
    'input.videoSuggestion.showFollowUps': 'Sugerowane kolejne pomysły',
    'input.videoSuggestion.hideFollowUps': 'Ukryj propozycje',
    'input.videoSuggestion.followUpChooserLabel':
      'Wybierz punkt wyjścia i edytuj go, jeśli chcesz.',
    'input.videoSuggestion.followUp.moreLikeQuery':
      'Znajdź więcej filmów podobnych do "{{query}}"',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" od innego twórcy lub kanału',
    'input.videoSuggestion.followUp.interviews':
      'Wywiady lub rozmowy o {{query}}',
    'input.videoSuggestion.followUp.clips':
      'Najciekawsze momenty lub wyróżniające się klipy o {{query}}',
    'input.videoSuggestion.followUp.creatorAppearances':
      'Wywiady, występy TV lub klipy na żywo z {{creator}}',
    'input.videoSuggestion.followUp.similarCreators':
      'Twórcy lub artyści podobni do {{creator}}',
    'input.videoSuggestion.followUp.topicAngle':
      '{{topic}} wyjaśnione z innej perspektywy',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} i powiązane filmy o {{topic}}',
    'input.videoSuggestion.followUp.channelStyle':
      'Filmy o podobnym klimacie do {{channel}}',
  },
  pt: {
    'input.videoSuggestion.showFollowUps': 'Sugestões de continuação',
    'input.videoSuggestion.hideFollowUps': 'Ocultar sugestões',
    'input.videoSuggestion.followUpChooserLabel':
      'Escolha um ponto de partida e edite-o se quiser.',
    'input.videoSuggestion.followUp.moreLikeQuery':
      'Encontre mais vídeos como "{{query}}"',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" de outro criador ou canal',
    'input.videoSuggestion.followUp.interviews':
      'Entrevistas ou conversas sobre {{query}}',
    'input.videoSuggestion.followUp.clips':
      'Destaques ou clipes marcantes de {{query}}',
    'input.videoSuggestion.followUp.creatorAppearances':
      'Entrevistas, aparições na TV ou clipes ao vivo de {{creator}}',
    'input.videoSuggestion.followUp.similarCreators':
      'Criadores ou artistas parecidos com {{creator}}',
    'input.videoSuggestion.followUp.topicAngle':
      '{{topic}} explicado por outro ângulo',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} e vídeos relacionados a {{topic}}',
    'input.videoSuggestion.followUp.channelStyle':
      'Vídeos com uma vibe parecida com a de {{channel}}',
  },
  ro: {
    'input.videoSuggestion.showFollowUps': 'Idei de continuare sugerate',
    'input.videoSuggestion.hideFollowUps': 'Ascunde ideile',
    'input.videoSuggestion.followUpChooserLabel':
      'Alege un punct de pornire, apoi editează-l dacă vrei.',
    'input.videoSuggestion.followUp.moreLikeQuery':
      'Găsește mai multe videoclipuri ca "{{query}}"',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" de la un alt creator sau canal',
    'input.videoSuggestion.followUp.interviews':
      'Interviuri sau conversații despre {{query}}',
    'input.videoSuggestion.followUp.clips':
      'Momente importante sau clipuri remarcabile despre {{query}}',
    'input.videoSuggestion.followUp.creatorAppearances':
      'Interviuri, apariții TV sau clipuri live cu {{creator}}',
    'input.videoSuggestion.followUp.similarCreators':
      'Creatori sau artiști similari cu {{creator}}',
    'input.videoSuggestion.followUp.topicAngle':
      '{{topic}} explicat dintr-un alt unghi',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} și videoclipuri legate de {{topic}}',
    'input.videoSuggestion.followUp.channelStyle':
      'Videoclipuri cu un stil asemănător cu {{channel}}',
  },
  ru: {
    'input.videoSuggestion.showFollowUps': 'Предлагаемые продолжения',
    'input.videoSuggestion.hideFollowUps': 'Скрыть продолжения',
    'input.videoSuggestion.followUpChooserLabel':
      'Выберите отправную точку и при желании отредактируйте ее.',
    'input.videoSuggestion.followUp.moreLikeQuery':
      'Найти больше видео, похожих на "{{query}}"',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" от другого автора или канала',
    'input.videoSuggestion.followUp.interviews':
      'Интервью или беседы о {{query}}',
    'input.videoSuggestion.followUp.clips':
      'Лучшие моменты или яркие клипы по {{query}}',
    'input.videoSuggestion.followUp.creatorAppearances':
      'Интервью, ТВ-появления или лайв-клипы с {{creator}}',
    'input.videoSuggestion.followUp.similarCreators':
      'Авторы или исполнители, похожие на {{creator}}',
    'input.videoSuggestion.followUp.topicAngle':
      '{{topic}} с объяснением под другим углом',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} и связанные видео о {{topic}}',
    'input.videoSuggestion.followUp.channelStyle':
      'Видео с похожей атмосферой, как у {{channel}}',
  },
  sv: {
    'input.videoSuggestion.showFollowUps': 'Föreslagna följdidéer',
    'input.videoSuggestion.hideFollowUps': 'Dölj följdidéer',
    'input.videoSuggestion.followUpChooserLabel':
      'Välj en startpunkt och redigera den om du vill.',
    'input.videoSuggestion.followUp.moreLikeQuery':
      'Hitta fler videor som "{{query}}"',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" från en annan skapare eller kanal',
    'input.videoSuggestion.followUp.interviews':
      'Intervjuer eller samtal om {{query}}',
    'input.videoSuggestion.followUp.clips':
      'Höjdpunkter eller starka klipp om {{query}}',
    'input.videoSuggestion.followUp.creatorAppearances':
      'Intervjuer, tv-framträdanden eller liveklipp med {{creator}}',
    'input.videoSuggestion.followUp.similarCreators':
      'Skapare eller artister som liknar {{creator}}',
    'input.videoSuggestion.followUp.topicAngle':
      '{{topic}} förklarat från en annan vinkel',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} och relaterade videor om {{topic}}',
    'input.videoSuggestion.followUp.channelStyle':
      'Videor med en liknande känsla som {{channel}}',
  },
  sw: {
    'input.videoSuggestion.showFollowUps': 'Mapendekezo ya mwendelezo',
    'input.videoSuggestion.hideFollowUps': 'Ficha mapendekezo ya mwendelezo',
    'input.videoSuggestion.followUpChooserLabel':
      'Chagua pa kuanzia, kisha uihariri ukitaka.',
    'input.videoSuggestion.followUp.moreLikeQuery':
      'Tafuta video zaidi kama "{{query}}"',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" kutoka kwa mtayarishi au chaneli nyingine',
    'input.videoSuggestion.followUp.interviews':
      'Mahojiano au mazungumzo kuhusu {{query}}',
    'input.videoSuggestion.followUp.clips':
      'Mambo muhimu au klipu zilizojitokeza za {{query}}',
    'input.videoSuggestion.followUp.creatorAppearances':
      'Mahojiano ya {{creator}}, kuonekana TV, au klipu za moja kwa moja',
    'input.videoSuggestion.followUp.similarCreators':
      'Watayarishi au wasanii wanaofanana na {{creator}}',
    'input.videoSuggestion.followUp.topicAngle':
      '{{topic}} imeelezewa kwa mtazamo mwingine',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} na video zinazohusiana na {{topic}}',
    'input.videoSuggestion.followUp.channelStyle':
      'Video zenye hisia zinazofanana na {{channel}}',
  },
  ta: {
    'input.videoSuggestion.showFollowUps': 'பரிந்துரைக்கப்பட்ட அடுத்த யோசனைகள்',
    'input.videoSuggestion.hideFollowUps': 'அடுத்த யோசனைகளை மறை',
    'input.videoSuggestion.followUpChooserLabel':
      'ஒரு தொடக்கப் புள்ளியை தேர்வு செய்து, வேண்டுமெனில் அதைத் திருத்துங்கள்.',
    'input.videoSuggestion.followUp.moreLikeQuery':
      '"{{query}}" போன்ற மேலும் வீடியோக்களை கண்டுபிடி',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" மற்றொரு உருவாக்குனர் அல்லது சேனலில் இருந்து',
    'input.videoSuggestion.followUp.interviews':
      '{{query}} பற்றிய நேர்காணல்கள் அல்லது உரையாடல்கள்',
    'input.videoSuggestion.followUp.clips':
      '{{query}}-இன் முக்கிய தருணங்கள் அல்லது சிறப்பான கிளிப்புகள்',
    'input.videoSuggestion.followUp.creatorAppearances':
      '{{creator}} நேர்காணல்கள், டிவி தோற்றங்கள் அல்லது நேரலை கிளிப்புகள்',
    'input.videoSuggestion.followUp.similarCreators':
      '{{creator}} போன்ற உருவாக்குனர்கள் அல்லது கலைஞர்கள்',
    'input.videoSuggestion.followUp.topicAngle':
      '{{topic}} வேறு கோணத்தில் விளக்கப்பட்டது',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} மற்றும் தொடர்புடைய {{topic}} வீடியோக்கள்',
    'input.videoSuggestion.followUp.channelStyle':
      '{{channel}} போன்ற உணர்வுள்ள வீடியோக்கள்',
  },
  te: {
    'input.videoSuggestion.showFollowUps': 'సూచించిన తదుపరి ఆలోచనలు',
    'input.videoSuggestion.hideFollowUps': 'తదుపరి ఆలోచనలు దాచు',
    'input.videoSuggestion.followUpChooserLabel':
      'ఒక ప్రారంభ బిందువును ఎంచుకుని, కావాలంటే దాన్ని సవరించండి.',
    'input.videoSuggestion.followUp.moreLikeQuery':
      '"{{query}}" లాంటి మరిన్ని వీడియోలు కనుగొనండి',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" మరో క్రియేటర్ లేదా ఛానల్ నుండి',
    'input.videoSuggestion.followUp.interviews':
      '{{query}} గురించి ఇంటర్వ్యూలు లేదా సంభాషణలు',
    'input.videoSuggestion.followUp.clips':
      '{{query}} హైలైట్స్ లేదా ప్రత్యేకంగా కనిపించే క్లిప్స్',
    'input.videoSuggestion.followUp.creatorAppearances':
      '{{creator}} ఇంటర్వ్యూలు, టీవీ ప్రదర్శనలు లేదా లైవ్ క్లిప్స్',
    'input.videoSuggestion.followUp.similarCreators':
      '{{creator}} లాంటి క్రియేటర్లు లేదా కళాకారులు',
    'input.videoSuggestion.followUp.topicAngle':
      '{{topic}} ను మరో కోణంలో వివరణ',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} మరియు సంబంధించిన {{topic}} వీడియోలు',
    'input.videoSuggestion.followUp.channelStyle':
      '{{channel}}లాంటి భావం ఉన్న వీడియోలు',
  },
  th: {
    'input.videoSuggestion.showFollowUps': 'คำแนะนำต่อยอด',
    'input.videoSuggestion.hideFollowUps': 'ซ่อนคำแนะนำต่อยอด',
    'input.videoSuggestion.followUpChooserLabel':
      'เลือกจุดเริ่มต้นก่อน แล้วค่อยแก้ไขถ้าต้องการ',
    'input.videoSuggestion.followUp.moreLikeQuery':
      'ค้นหาวิดีโอเพิ่มเติมแบบ "{{query}}"',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" จากครีเอเตอร์หรือช่องอื่น',
    'input.videoSuggestion.followUp.interviews':
      'บทสัมภาษณ์หรือบทสนทนาเกี่ยวกับ {{query}}',
    'input.videoSuggestion.followUp.clips': 'ไฮไลต์หรือคลิปเด่นของ {{query}}',
    'input.videoSuggestion.followUp.creatorAppearances':
      'บทสัมภาษณ์ การออกรายการทีวี หรือคลิปไลฟ์ของ {{creator}}',
    'input.videoSuggestion.followUp.similarCreators':
      'ครีเอเตอร์หรือศิลปินที่คล้ายกับ {{creator}}',
    'input.videoSuggestion.followUp.topicAngle':
      '{{topic}} ที่อธิบายจากอีกมุมหนึ่ง',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} และวิดีโอที่เกี่ยวข้องกับ {{topic}}',
    'input.videoSuggestion.followUp.channelStyle':
      'วิดีโอที่ให้อารมณ์คล้าย {{channel}}',
  },
  tl: {
    'input.videoSuggestion.showFollowUps': 'Mga mungkahing kasunod',
    'input.videoSuggestion.hideFollowUps': 'Itago ang mga mungkahing kasunod',
    'input.videoSuggestion.followUpChooserLabel':
      'Pumili ng panimulang punto, tapos i-edit mo kung gusto mo.',
    'input.videoSuggestion.followUp.moreLikeQuery':
      'Maghanap ng higit pang video na tulad ng "{{query}}"',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" mula sa ibang creator o channel',
    'input.videoSuggestion.followUp.interviews':
      'Mga interview o usapan tungkol sa {{query}}',
    'input.videoSuggestion.followUp.clips':
      'Mga highlight o kapansin-pansing clip ng {{query}}',
    'input.videoSuggestion.followUp.creatorAppearances':
      'Mga interview, TV appearance, o live clip ni {{creator}}',
    'input.videoSuggestion.followUp.similarCreators':
      'Mga creator o artist na kahawig ni {{creator}}',
    'input.videoSuggestion.followUp.topicAngle':
      '{{topic}} na ipinaliwanag mula sa ibang anggulo',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} at mga kaugnay na video tungkol sa {{topic}}',
    'input.videoSuggestion.followUp.channelStyle':
      'Mga video na may kaparehong dating ng {{channel}}',
  },
  tr: {
    'input.videoSuggestion.showFollowUps': 'Önerilen devam fikirleri',
    'input.videoSuggestion.hideFollowUps': 'Devam fikirlerini gizle',
    'input.videoSuggestion.followUpChooserLabel':
      'Bir başlangıç noktası seç, sonra istersen düzenle.',
    'input.videoSuggestion.followUp.moreLikeQuery':
      '"{{query}}" gibi daha fazla video bul',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" için başka bir üretici veya kanaldan sonuçlar',
    'input.videoSuggestion.followUp.interviews':
      '{{query}} hakkında röportajlar veya sohbetler',
    'input.videoSuggestion.followUp.clips':
      '{{query}} öne çıkan anlar veya dikkat çeken klipler',
    'input.videoSuggestion.followUp.creatorAppearances':
      '{{creator}} röportajları, TV görünümleri veya canlı klipleri',
    'input.videoSuggestion.followUp.similarCreators':
      '{{creator}} benzeri üreticiler veya sanatçılar',
    'input.videoSuggestion.followUp.topicAngle':
      '{{topic}} farklı bir açıdan anlatılıyor',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} ve ilgili {{topic}} videoları',
    'input.videoSuggestion.followUp.channelStyle':
      '{{channel}} ile benzer his taşıyan videolar',
  },
  uk: {
    'input.videoSuggestion.showFollowUps': 'Запропоновані продовження',
    'input.videoSuggestion.hideFollowUps': 'Сховати продовження',
    'input.videoSuggestion.followUpChooserLabel':
      'Виберіть відправну точку й за бажанням відредагуйте її.',
    'input.videoSuggestion.followUp.moreLikeQuery':
      'Знайти більше відео, схожих на "{{query}}"',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" від іншого автора або каналу',
    'input.videoSuggestion.followUp.interviews':
      "Інтерв'ю чи розмови про {{query}}",
    'input.videoSuggestion.followUp.clips':
      'Найкращі моменти або виразні кліпи про {{query}}',
    'input.videoSuggestion.followUp.creatorAppearances':
      "Інтерв'ю, телепояви або лайв-кліпи з {{creator}}",
    'input.videoSuggestion.followUp.similarCreators':
      'Автори чи артисти, схожі на {{creator}}',
    'input.videoSuggestion.followUp.topicAngle':
      '{{topic}} пояснено з іншого ракурсу',
    'input.videoSuggestion.followUp.topicCreator':
      "{{creator}} і пов'язані відео про {{topic}}",
    'input.videoSuggestion.followUp.channelStyle':
      'Відео з атмосферою, схожою на {{channel}}',
  },
  ur: {
    'input.videoSuggestion.showFollowUps': 'تجویز کردہ اگلے خیالات',
    'input.videoSuggestion.hideFollowUps': 'اگلے خیالات چھپائیں',
    'input.videoSuggestion.followUpChooserLabel':
      'ایک نقطہ آغاز چنیں، پھر چاہیں تو اسے ایڈٹ کر لیں۔',
    'input.videoSuggestion.followUp.moreLikeQuery':
      '"{{query}}" جیسی مزید ویڈیوز تلاش کریں',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" کسی اور تخلیق کار یا چینل سے',
    'input.videoSuggestion.followUp.interviews':
      '{{query}} پر انٹرویوز یا گفتگو',
    'input.videoSuggestion.followUp.clips':
      '{{query}} کے ہائی لائٹس یا نمایاں کلپس',
    'input.videoSuggestion.followUp.creatorAppearances':
      '{{creator}} کے انٹرویوز، ٹی وی پیشیاں یا لائیو کلپس',
    'input.videoSuggestion.followUp.similarCreators':
      '{{creator}} جیسے تخلیق کار یا فنکار',
    'input.videoSuggestion.followUp.topicAngle':
      '{{topic}} کو ایک مختلف زاویے سے سمجھایا گیا',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} اور {{topic}} سے متعلق ویڈیوز',
    'input.videoSuggestion.followUp.channelStyle':
      '{{channel}} جیسا احساس رکھنے والی ویڈیوز',
  },
  vi: {
    'input.videoSuggestion.showFollowUps': 'Gợi ý tiếp theo',
    'input.videoSuggestion.hideFollowUps': 'Ẩn gợi ý tiếp theo',
    'input.videoSuggestion.followUpChooserLabel':
      'Chọn một điểm bắt đầu rồi chỉnh lại nếu muốn.',
    'input.videoSuggestion.followUp.moreLikeQuery':
      'Tìm thêm video giống "{{query}}"',
    'input.videoSuggestion.followUp.differentCreator':
      '"{{query}}" từ một nhà sáng tạo hoặc kênh khác',
    'input.videoSuggestion.followUp.interviews':
      'Phỏng vấn hoặc trò chuyện về {{query}}',
    'input.videoSuggestion.followUp.clips':
      'Những đoạn nổi bật hoặc clip đáng chú ý về {{query}}',
    'input.videoSuggestion.followUp.creatorAppearances':
      'Phỏng vấn, lần xuất hiện trên TV hoặc clip trực tiếp của {{creator}}',
    'input.videoSuggestion.followUp.similarCreators':
      'Nhà sáng tạo hoặc nghệ sĩ giống {{creator}}',
    'input.videoSuggestion.followUp.topicAngle':
      '{{topic}} được giải thích từ một góc nhìn khác',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} và các video liên quan đến {{topic}}',
    'input.videoSuggestion.followUp.channelStyle':
      'Video có cảm giác tương tự {{channel}}',
  },
  'zh-CN': {
    'input.videoSuggestion.useLastSearch': '使用上次设置',
    'input.videoSuggestion.showFollowUps': '推荐的后续想法',
    'input.videoSuggestion.hideFollowUps': '隐藏后续想法',
    'input.videoSuggestion.followUpChooserLabel':
      '先选一个起点，想改的话再编辑。',
    'input.videoSuggestion.followUp.moreLikeQuery':
      '查找更多像 "{{query}}" 这样的视频',
    'input.videoSuggestion.followUp.differentCreator':
      '来自其他创作者或频道的 "{{query}}"',
    'input.videoSuggestion.followUp.interviews':
      '与 {{query}} 相关的采访或对谈',
    'input.videoSuggestion.followUp.clips': '{{query}} 的高光片段或精彩剪辑',
    'input.videoSuggestion.followUp.creatorAppearances':
      '{{creator}} 的采访、电视露面或现场片段',
    'input.videoSuggestion.followUp.similarCreators':
      '与 {{creator}} 相似的创作者或艺人',
    'input.videoSuggestion.followUp.topicAngle': '从不同角度讲解 {{topic}}',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} 和相关的 {{topic}} 视频',
    'input.videoSuggestion.followUp.channelStyle':
      '风格感觉与 {{channel}} 相似的视频',
  },
  'zh-TW': {
    'input.videoSuggestion.showFollowUps': '推薦的後續想法',
    'input.videoSuggestion.hideFollowUps': '隱藏後續想法',
    'input.videoSuggestion.followUpChooserLabel':
      '先選一個起點，想改的話再編輯。',
    'input.videoSuggestion.followUp.moreLikeQuery':
      '查找更多像 "{{query}}" 這樣的影片',
    'input.videoSuggestion.followUp.differentCreator':
      '來自其他創作者或頻道的 "{{query}}"',
    'input.videoSuggestion.followUp.interviews':
      '與 {{query}} 相關的訪談或對談',
    'input.videoSuggestion.followUp.clips': '{{query}} 的精華片段或亮眼剪輯',
    'input.videoSuggestion.followUp.creatorAppearances':
      '{{creator}} 的訪談、電視露面或現場片段',
    'input.videoSuggestion.followUp.similarCreators':
      '與 {{creator}} 類似的創作者或藝人',
    'input.videoSuggestion.followUp.topicAngle': '從不同角度講解 {{topic}}',
    'input.videoSuggestion.followUp.topicCreator':
      '{{creator}} 和相關的 {{topic}} 影片',
    'input.videoSuggestion.followUp.channelStyle':
      '風格感覺與 {{channel}} 相似的影片',
  },
};

const videoSuggestionContextOverrides = {
  af: {
    'input.videoSuggestion.savedToFolder': 'In jou gids gestoor',
    'input.videoSuggestion.tempFileAvailable': 'Tydelike kopie nog beskikbaar',
    'input.videoSuggestion.localFileAvailable': 'Lêer beskikbaar',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'Sluit my aflaaigeskiedenis in',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'Laat KI jou onlangse afgelaaide videotitels as sagte konteks gebruik vir beter voorstelle.',
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'Sluit my gekykte kanale in',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'Laat KI jou onlangse kanaalgeskiedenis as sagte konteks gebruik vir beter voorstelle.',
    'input.videoSuggestion.followUp.moreFromHistory':
      'Nog video\'s soos "{{title}}"',
    'input.videoSuggestion.followUp.channelFromHistory':
      "Video's van kanale soos {{channel}}",
  },
  ar: {
    'input.videoSuggestion.savedToFolder': 'تم الحفظ في مجلدك',
    'input.videoSuggestion.tempFileAvailable': 'ما تزال النسخة المؤقتة متاحة',
    'input.videoSuggestion.localFileAvailable': 'الملف متاح',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'أدرج سجل التنزيلات الخاص بي',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'اسمح للذكاء الاصطناعي باستخدام عناوين الفيديوهات التي نزّلتها مؤخرًا كسياق خفيف لتحسين الاقتراحات.',
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'أدرج القنوات التي شاهدتها',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'اسمح للذكاء الاصطناعي باستخدام سجل القنوات الأخير كسياق خفيف لتحسين الاقتراحات.',
    'input.videoSuggestion.followUp.moreFromHistory':
      'المزيد من الفيديوهات مثل "{{title}}"',
    'input.videoSuggestion.followUp.channelFromHistory':
      'فيديوهات من قنوات مثل {{channel}}',
  },
  bn: {
    'input.videoSuggestion.savedToFolder': 'আপনার ফোল্ডারে সংরক্ষিত',
    'input.videoSuggestion.tempFileAvailable': 'টেম্প কপি এখনও উপলব্ধ',
    'input.videoSuggestion.localFileAvailable': 'ফাইল উপলব্ধ',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'আমার ডাউনলোড ইতিহাস অন্তর্ভুক্ত করুন',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'আরও ভালো পরামর্শের জন্য AI-কে আপনার সাম্প্রতিক ডাউনলোড করা ভিডিওর শিরোনামগুলো হালকা প্রসঙ্গ হিসেবে ব্যবহার করতে দিন।',
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'আমি যেসব চ্যানেল দেখেছি সেগুলো অন্তর্ভুক্ত করুন',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'আরও ভালো পরামর্শের জন্য AI-কে আপনার সাম্প্রতিক চ্যানেল ইতিহাস হালকা প্রসঙ্গ হিসেবে ব্যবহার করতে দিন।',
    'input.videoSuggestion.followUp.moreFromHistory':
      '"{{title}}"-এর মতো আরও ভিডিও',
    'input.videoSuggestion.followUp.channelFromHistory':
      '{{channel}}-এর মতো চ্যানেল থেকে ভিডিও',
  },
  cs: {
    'input.videoSuggestion.savedToFolder': 'Uloženo do vaší složky',
    'input.videoSuggestion.tempFileAvailable':
      'Dočasná kopie je stále k dispozici',
    'input.videoSuggestion.localFileAvailable': 'Soubor je k dispozici',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'Zahrnout mou historii stahování',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'Povol AI používat názvy vašich nedávno stažených videí jako lehký kontext pro lepší návrhy.',
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'Zahrnout kanály, které sleduji',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'Povol AI používat vaši nedávnou historii kanálů jako lehký kontext pro lepší návrhy.',
    'input.videoSuggestion.followUp.moreFromHistory':
      'Další videa jako "{{title}}"',
    'input.videoSuggestion.followUp.channelFromHistory':
      'Videa z kanálů jako {{channel}}',
  },
  da: {
    'input.videoSuggestion.savedToFolder': 'Gemt i din mappe',
    'input.videoSuggestion.tempFileAvailable':
      'Midlertidig kopi er stadig tilgængelig',
    'input.videoSuggestion.localFileAvailable': 'Fil tilgængelig',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'Medtag min downloadhistorik',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'Lad AI bruge titlerne på dine nyligt downloadede videoer som blød kontekst til bedre forslag.',
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'Medtag mine sete kanaler',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'Lad AI bruge din seneste kanalhistorik som blød kontekst til bedre forslag.',
    'input.videoSuggestion.followUp.moreFromHistory':
      'Flere videoer som "{{title}}"',
    'input.videoSuggestion.followUp.channelFromHistory':
      'Videoer fra kanaler som {{channel}}',
  },
  de: {
    'input.videoSuggestion.savedToFolder': 'In deinem Ordner gespeichert',
    'input.videoSuggestion.tempFileAvailable': 'Temporäre Kopie noch verfügbar',
    'input.videoSuggestion.localFileAvailable': 'Datei verfügbar',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'Meinen Downloadverlauf einbeziehen',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'Lass die KI die Titel deiner zuletzt heruntergeladenen Videos als weichen Kontext für bessere Vorschläge nutzen.',
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'Meine angesehenen Kanäle einbeziehen',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'Lass die KI deinen jüngsten Kanalverlauf als weichen Kontext für bessere Vorschläge nutzen.',
    'input.videoSuggestion.followUp.moreFromHistory':
      'Mehr Videos wie "{{title}}"',
    'input.videoSuggestion.followUp.channelFromHistory':
      'Videos von Kanälen wie {{channel}}',
  },
  el: {
    'input.videoSuggestion.savedToFolder': 'Αποθηκεύτηκε στον φάκελό σας',
    'input.videoSuggestion.tempFileAvailable':
      'Το προσωρινό αντίγραφο είναι ακόμη διαθέσιμο',
    'input.videoSuggestion.localFileAvailable': 'Το αρχείο είναι διαθέσιμο',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'Συμπερίληψη του ιστορικού λήψεών μου',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'Άφησε την AI να χρησιμοποιεί τους τίτλους των πρόσφατα κατεβασμένων βίντεό σου ως ελαφρύ πλαίσιο για καλύτερες προτάσεις.',
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'Συμπερίληψη των καναλιών που παρακολουθώ',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'Άφησε την AI να χρησιμοποιεί το πρόσφατο ιστορικό καναλιών σου ως ελαφρύ πλαίσιο για καλύτερες προτάσεις.',
    'input.videoSuggestion.followUp.moreFromHistory':
      'Περισσότερα βίντεο σαν το "{{title}}"',
    'input.videoSuggestion.followUp.channelFromHistory':
      'Βίντεο από κανάλια σαν το {{channel}}',
  },
  es: {
    'input.videoSuggestion.savedToFolder': 'Guardado en tu carpeta',
    'input.videoSuggestion.tempFileAvailable':
      'La copia temporal sigue disponible',
    'input.videoSuggestion.localFileAvailable': 'Archivo disponible',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'Incluir mi historial de descargas',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'Deja que la IA use los títulos de tus videos descargados recientemente como contexto suave para mejores sugerencias.',
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'Incluir mis canales vistos',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'Deja que la IA use tu historial reciente de canales como contexto suave para mejores sugerencias.',
    'input.videoSuggestion.followUp.moreFromHistory':
      'Más videos como "{{title}}"',
    'input.videoSuggestion.followUp.channelFromHistory':
      'Videos de canales como {{channel}}',
  },
  fa: {
    'input.videoSuggestion.savedToFolder': 'در پوشهٔ شما ذخیره شد',
    'input.videoSuggestion.tempFileAvailable': 'نسخهٔ موقت هنوز در دسترس است',
    'input.videoSuggestion.localFileAvailable': 'فایل در دسترس است',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'تاریخچهٔ دانلود من را هم لحاظ کن',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'اجازه بده AI عنوان ویدیوهای دانلودشدهٔ اخیر شما را به‌عنوان زمینهٔ سبک برای پیشنهادهای بهتر استفاده کند.',
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'کانال‌هایی که دیده‌ام را هم لحاظ کن',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'اجازه بده AI تاریخچهٔ اخیر کانال‌های شما را به‌عنوان زمینهٔ سبک برای پیشنهادهای بهتر استفاده کند.',
    'input.videoSuggestion.followUp.moreFromHistory':
      'ویدیوهای بیشتری مثل "{{title}}"',
    'input.videoSuggestion.followUp.channelFromHistory':
      'ویدیوهایی از کانال‌هایی مثل {{channel}}',
  },
  fi: {
    'input.videoSuggestion.savedToFolder': 'Tallennettu kansioosi',
    'input.videoSuggestion.tempFileAvailable':
      'Väliaikainen kopio on yhä saatavilla',
    'input.videoSuggestion.localFileAvailable': 'Tiedosto saatavilla',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'Sisällytä lataushistoriani',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'Anna tekoälyn käyttää viimeksi lataamiesi videoiden otsikoita kevyenä kontekstina parempia ehdotuksia varten.',
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'Sisällytä katsomani kanavat',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'Anna tekoälyn käyttää viimeaikaista kanavahistoriaasi kevyenä kontekstina parempia ehdotuksia varten.',
    'input.videoSuggestion.followUp.moreFromHistory':
      'Lisää videoita kuten "{{title}}"',
    'input.videoSuggestion.followUp.channelFromHistory':
      'Videoita kanavilta kuten {{channel}}',
  },
  fr: {
    'input.videoSuggestion.savedToFolder': 'Enregistré dans votre dossier',
    'input.videoSuggestion.tempFileAvailable':
      'La copie temporaire est toujours disponible',
    'input.videoSuggestion.localFileAvailable': 'Fichier disponible',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'Inclure mon historique de téléchargements',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'Laissez l’IA utiliser les titres de vos vidéos récemment téléchargées comme contexte léger pour de meilleures suggestions.',
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'Inclure les chaînes que j’ai regardées',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'Laissez l’IA utiliser l’historique récent de vos chaînes comme contexte léger pour de meilleures suggestions.',
    'input.videoSuggestion.followUp.moreFromHistory':
      'Plus de vidéos comme "{{title}}"',
    'input.videoSuggestion.followUp.channelFromHistory':
      'Des vidéos de chaînes comme {{channel}}',
  },
  he: {
    'input.videoSuggestion.savedToFolder': 'נשמר בתיקייה שלך',
    'input.videoSuggestion.tempFileAvailable': 'העותק הזמני עדיין זמין',
    'input.videoSuggestion.localFileAvailable': 'הקובץ זמין',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'כלול את היסטוריית ההורדות שלי',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'אפשר ל-AI להשתמש בכותרות הסרטונים שהורדת לאחרונה כהקשר קל להצעות טובות יותר.',
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'כלול את הערוצים שצפיתי בהם',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'אפשר ל-AI להשתמש בהיסטוריית הערוצים האחרונה שלך כהקשר קל להצעות טובות יותר.',
    'input.videoSuggestion.followUp.moreFromHistory':
      'עוד סרטונים כמו "{{title}}"',
    'input.videoSuggestion.followUp.channelFromHistory':
      'סרטונים מערוצים כמו {{channel}}',
  },
  hi: {
    'input.videoSuggestion.savedToFolder': 'आपके फ़ोल्डर में सहेजा गया',
    'input.videoSuggestion.tempFileAvailable': 'अस्थायी कॉपी अभी भी उपलब्ध है',
    'input.videoSuggestion.localFileAvailable': 'फ़ाइल उपलब्ध है',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'मेरा डाउनलोड इतिहास शामिल करें',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'बेहतर सुझावों के लिए AI को हाल ही में डाउनलोड किए गए वीडियो शीर्षकों को हल्के संदर्भ के रूप में इस्तेमाल करने दें।',
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'मेरे देखे गए चैनल शामिल करें',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'बेहतर सुझावों के लिए AI को आपके हाल के चैनल इतिहास को हल्के संदर्भ के रूप में इस्तेमाल करने दें।',
    'input.videoSuggestion.followUp.moreFromHistory':
      '"{{title}}" जैसे और वीडियो',
    'input.videoSuggestion.followUp.channelFromHistory':
      '{{channel}} जैसे चैनलों के वीडियो',
  },
  hu: {
    'input.videoSuggestion.savedToFolder': 'A mappádba mentve',
    'input.videoSuggestion.tempFileAvailable':
      'Az ideiglenes másolat még elérhető',
    'input.videoSuggestion.localFileAvailable': 'Fájl elérhető',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'A letöltési előzményeim belefoglalása',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'Engedd, hogy az AI a nemrég letöltött videóid címeit laza kontextusként használja jobb javaslatokhoz.',
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'A megtekintett csatornáim belefoglalása',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'Engedd, hogy az AI a friss csatornaelőzményeidet laza kontextusként használja jobb javaslatokhoz.',
    'input.videoSuggestion.followUp.moreFromHistory':
      'Több videó, mint "{{title}}"',
    'input.videoSuggestion.followUp.channelFromHistory':
      'Videók olyan csatornáktól, mint {{channel}}',
  },
  id: {
    'input.videoSuggestion.savedToFolder': 'Disimpan ke folder Anda',
    'input.videoSuggestion.tempFileAvailable':
      'Salinan sementara masih tersedia',
    'input.videoSuggestion.localFileAvailable': 'File tersedia',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'Sertakan riwayat unduhan saya',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'Biarkan AI menggunakan judul video yang baru Anda unduh sebagai konteks ringan untuk saran yang lebih baik.',
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'Sertakan channel yang saya tonton',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'Biarkan AI menggunakan riwayat channel terbaru Anda sebagai konteks ringan untuk saran yang lebih baik.',
    'input.videoSuggestion.followUp.moreFromHistory':
      'Lebih banyak video seperti "{{title}}"',
    'input.videoSuggestion.followUp.channelFromHistory':
      'Video dari channel seperti {{channel}}',
  },
  it: {
    'input.videoSuggestion.savedToFolder': 'Salvato nella tua cartella',
    'input.videoSuggestion.tempFileAvailable':
      'La copia temporanea è ancora disponibile',
    'input.videoSuggestion.localFileAvailable': 'File disponibile',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'Includi la mia cronologia dei download',
    'input.videoSuggestion.includeDownloadHistoryHint':
      "Consenti all'AI di usare i titoli dei video scaricati di recente come contesto leggero per suggerimenti migliori.",
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'Includi i canali che ho guardato',
    'input.videoSuggestion.includeWatchedChannelsHint':
      "Consenti all'AI di usare la tua cronologia recente dei canali come contesto leggero per suggerimenti migliori.",
    'input.videoSuggestion.followUp.moreFromHistory':
      'Altri video come "{{title}}"',
    'input.videoSuggestion.followUp.channelFromHistory':
      'Video da canali come {{channel}}',
  },
  ja: {
    'input.videoSuggestion.savedToFolder': 'フォルダに保存済み',
    'input.videoSuggestion.tempFileAvailable': '一時コピーはまだ利用できます',
    'input.videoSuggestion.localFileAvailable': 'ファイルを利用できます',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      '自分のダウンロード履歴を含める',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'より良い提案のために、最近ダウンロードした動画タイトルをAIが軽い文脈として使えるようにします。',
    'input.videoSuggestion.includeWatchedChannelsLabel':
      '自分が見たチャンネルを含める',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'より良い提案のために、最近のチャンネル履歴をAIが軽い文脈として使えるようにします。',
    'input.videoSuggestion.followUp.moreFromHistory':
      '"{{title}}" のような動画をもっと見る',
    'input.videoSuggestion.followUp.channelFromHistory':
      '{{channel}} のようなチャンネルの動画',
  },
  ko: {
    'input.videoSuggestion.savedToFolder': '내 폴더에 저장됨',
    'input.videoSuggestion.tempFileAvailable': '임시 사본이 아직 남아 있습니다',
    'input.videoSuggestion.localFileAvailable': '파일을 사용할 수 있습니다',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      '내 다운로드 기록 포함',
    'input.videoSuggestion.includeDownloadHistoryHint':
      '더 나은 추천을 위해 최근 다운로드한 비디오 제목을 AI가 가벼운 문맥으로 활용하도록 합니다.',
    'input.videoSuggestion.includeWatchedChannelsLabel': '내가 본 채널 포함',
    'input.videoSuggestion.includeWatchedChannelsHint':
      '더 나은 추천을 위해 최근 채널 기록을 AI가 가벼운 문맥으로 활용하도록 합니다.',
    'input.videoSuggestion.followUp.moreFromHistory':
      '"{{title}}" 같은 영상 더 보기',
    'input.videoSuggestion.followUp.channelFromHistory':
      '{{channel}} 같은 채널의 영상',
  },
  mr: {
    'input.videoSuggestion.savedToFolder': 'तुमच्या फोल्डरमध्ये जतन केले',
    'input.videoSuggestion.tempFileAvailable': 'तात्पुरती प्रत अजून उपलब्ध आहे',
    'input.videoSuggestion.localFileAvailable': 'फाइल उपलब्ध आहे',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'माझा डाउनलोड इतिहास समाविष्ट करा',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'चांगल्या सूचनांसाठी AI ला अलीकडे डाउनलोड केलेल्या व्हिडिओंची शीर्षके हलक्या संदर्भ म्हणून वापरू द्या.',
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'मी पाहिलेले चॅनेल समाविष्ट करा',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'चांगल्या सूचनांसाठी AI ला तुमचा अलीकडचा चॅनेल इतिहास हलक्या संदर्भ म्हणून वापरू द्या.',
    'input.videoSuggestion.followUp.moreFromHistory':
      '"{{title}}" सारखे आणखी व्हिडिओ',
    'input.videoSuggestion.followUp.channelFromHistory':
      '{{channel}} सारख्या चॅनेलमधील व्हिडिओ',
  },
  ms: {
    'input.videoSuggestion.savedToFolder': 'Disimpan ke folder anda',
    'input.videoSuggestion.tempFileAvailable':
      'Salinan sementara masih tersedia',
    'input.videoSuggestion.localFileAvailable': 'Fail tersedia',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'Sertakan sejarah muat turun saya',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'Benarkan AI menggunakan tajuk video yang anda muat turun baru-baru ini sebagai konteks ringan untuk cadangan yang lebih baik.',
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'Sertakan saluran yang saya tonton',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'Benarkan AI menggunakan sejarah saluran terbaru anda sebagai konteks ringan untuk cadangan yang lebih baik.',
    'input.videoSuggestion.followUp.moreFromHistory':
      'Lebih banyak video seperti "{{title}}"',
    'input.videoSuggestion.followUp.channelFromHistory':
      'Video daripada saluran seperti {{channel}}',
  },
  nl: {
    'input.videoSuggestion.savedToFolder': 'Opgeslagen in je map',
    'input.videoSuggestion.tempFileAvailable':
      'Tijdelijke kopie nog beschikbaar',
    'input.videoSuggestion.localFileAvailable': 'Bestand beschikbaar',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'Mijn downloadgeschiedenis meenemen',
    'input.videoSuggestion.includeDownloadHistoryHint':
      "Laat AI de titels van je recent gedownloade video's gebruiken als lichte context voor betere suggesties.",
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'Mijn bekeken kanalen meenemen',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'Laat AI je recente kanaalgeschiedenis gebruiken als lichte context voor betere suggesties.',
    'input.videoSuggestion.followUp.moreFromHistory':
      'Meer video\'s zoals "{{title}}"',
    'input.videoSuggestion.followUp.channelFromHistory':
      "Video's van kanalen zoals {{channel}}",
  },
  no: {
    'input.videoSuggestion.savedToFolder': 'Lagret i mappen din',
    'input.videoSuggestion.tempFileAvailable':
      'Midlertidig kopi er fortsatt tilgjengelig',
    'input.videoSuggestion.localFileAvailable': 'Fil tilgjengelig',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'Ta med nedlastingshistorikken min',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'La AI bruke titlene på nylig nedlastede videoer som lett kontekst for bedre forslag.',
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'Ta med kanalene jeg har sett',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'La AI bruke den siste kanalhistorikken din som lett kontekst for bedre forslag.',
    'input.videoSuggestion.followUp.moreFromHistory':
      'Flere videoer som "{{title}}"',
    'input.videoSuggestion.followUp.channelFromHistory':
      'Videoer fra kanaler som {{channel}}',
  },
  pl: {
    'input.videoSuggestion.savedToFolder': 'Zapisano w twoim folderze',
    'input.videoSuggestion.tempFileAvailable':
      'Tymczasowa kopia jest nadal dostępna',
    'input.videoSuggestion.localFileAvailable': 'Plik jest dostępny',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'Uwzględnij moją historię pobierania',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'Pozwól AI używać tytułów ostatnio pobranych filmów jako lekkiego kontekstu do lepszych sugestii.',
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'Uwzględnij oglądane przeze mnie kanały',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'Pozwól AI używać twojej ostatniej historii kanałów jako lekkiego kontekstu do lepszych sugestii.',
    'input.videoSuggestion.followUp.moreFromHistory':
      'Więcej filmów takich jak "{{title}}"',
    'input.videoSuggestion.followUp.channelFromHistory':
      'Filmy z kanałów takich jak {{channel}}',
  },
  pt: {
    'input.videoSuggestion.savedToFolder': 'Salvo na sua pasta',
    'input.videoSuggestion.tempFileAvailable':
      'A cópia temporária ainda está disponível',
    'input.videoSuggestion.localFileAvailable': 'Arquivo disponível',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'Incluir meu histórico de downloads',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'Permita que a IA use os títulos dos vídeos baixados recentemente como contexto leve para sugestões melhores.',
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'Incluir os canais que assisti',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'Permita que a IA use seu histórico recente de canais como contexto leve para sugestões melhores.',
    'input.videoSuggestion.followUp.moreFromHistory':
      'Mais vídeos como "{{title}}"',
    'input.videoSuggestion.followUp.channelFromHistory':
      'Vídeos de canais como {{channel}}',
  },
  ro: {
    'input.videoSuggestion.savedToFolder': 'Salvat în folderul tău',
    'input.videoSuggestion.tempFileAvailable':
      'Copia temporară este încă disponibilă',
    'input.videoSuggestion.localFileAvailable': 'Fișier disponibil',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'Include istoricul meu de descărcări',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'Lasă AI-ul să folosească titlurile videoclipurilor descărcate recent ca context ușor pentru sugestii mai bune.',
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'Include canalele pe care le-am urmărit',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'Lasă AI-ul să folosească istoricul tău recent de canale ca context ușor pentru sugestii mai bune.',
    'input.videoSuggestion.followUp.moreFromHistory':
      'Mai multe videoclipuri precum "{{title}}"',
    'input.videoSuggestion.followUp.channelFromHistory':
      'Videoclipuri de la canale precum {{channel}}',
  },
  ru: {
    'input.videoSuggestion.savedToFolder': 'Сохранено в вашу папку',
    'input.videoSuggestion.tempFileAvailable':
      'Временная копия всё ещё доступна',
    'input.videoSuggestion.localFileAvailable': 'Файл доступен',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'Включить мою историю загрузок',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'Разрешить ИИ использовать названия недавно загруженных видео как лёгкий контекст для лучших рекомендаций.',
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'Включить каналы, которые я смотрел',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'Разрешить ИИ использовать вашу недавнюю историю каналов как лёгкий контекст для лучших рекомендаций.',
    'input.videoSuggestion.followUp.moreFromHistory':
      'Больше видео вроде "{{title}}"',
    'input.videoSuggestion.followUp.channelFromHistory':
      'Видео с каналов вроде {{channel}}',
  },
  sv: {
    'input.videoSuggestion.savedToFolder': 'Sparad i din mapp',
    'input.videoSuggestion.tempFileAvailable':
      'Tillfällig kopia finns fortfarande kvar',
    'input.videoSuggestion.localFileAvailable': 'Fil tillgänglig',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'Inkludera min nedladdningshistorik',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'Låt AI använda titlarna på dina nyligen nedladdade videor som lätt kontext för bättre förslag.',
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'Inkludera mina tittade kanaler',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'Låt AI använda din senaste kanalhistorik som lätt kontext för bättre förslag.',
    'input.videoSuggestion.followUp.moreFromHistory':
      'Fler videor som "{{title}}"',
    'input.videoSuggestion.followUp.channelFromHistory':
      'Videor från kanaler som {{channel}}',
  },
  sw: {
    'input.videoSuggestion.savedToFolder': 'Imehifadhiwa kwenye folda yako',
    'input.videoSuggestion.tempFileAvailable':
      'Nakala ya muda bado inapatikana',
    'input.videoSuggestion.localFileAvailable': 'Faili inapatikana',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'Jumuisha historia yangu ya upakuaji',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'Ruhusu AI itumie majina ya video ulizopakua hivi karibuni kama muktadha mwepesi kwa mapendekezo bora.',
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'Jumuisha vituo nilivyotazama',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'Ruhusu AI itumie historia yako ya hivi karibuni ya vituo kama muktadha mwepesi kwa mapendekezo bora.',
    'input.videoSuggestion.followUp.moreFromHistory':
      'Video zaidi kama "{{title}}"',
    'input.videoSuggestion.followUp.channelFromHistory':
      'Video kutoka vituo kama {{channel}}',
  },
  ta: {
    'input.videoSuggestion.savedToFolder':
      'உங்கள் கோப்புறையில் சேமிக்கப்பட்டது',
    'input.videoSuggestion.tempFileAvailable':
      'தற்காலிக நகல் இன்னும் கிடைக்கிறது',
    'input.videoSuggestion.localFileAvailable': 'கோப்பு கிடைக்கிறது',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'என் பதிவிறக்க வரலாற்றை சேர்க்கவும்',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'சிறந்த பரிந்துரைகளுக்காக நீங்கள் சமீபத்தில் பதிவிறக்கிய வீடியோ தலைப்புகளை AI மென்மையான சூழலாக பயன்படுத்த அனுமதிக்கவும்.',
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'நான் பார்த்த சேனல்களை சேர்க்கவும்',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'சிறந்த பரிந்துரைகளுக்காக உங்கள் சமீபத்திய சேனல் வரலாற்றை AI மென்மையான சூழலாக பயன்படுத்த அனுமதிக்கவும்.',
    'input.videoSuggestion.followUp.moreFromHistory':
      '"{{title}}" போன்ற மேலும் வீடியோக்கள்',
    'input.videoSuggestion.followUp.channelFromHistory':
      '{{channel}} போன்ற சேனல்களிலிருந்து வீடியோக்கள்',
  },
  te: {
    'input.videoSuggestion.savedToFolder': 'మీ ఫోల్డర్‌లో సేవ్ అయింది',
    'input.videoSuggestion.tempFileAvailable':
      'తాత్కాలిక కాపీ ఇంకా అందుబాటులో ఉంది',
    'input.videoSuggestion.localFileAvailable': 'ఫైల్ అందుబాటులో ఉంది',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'నా డౌన్‌లోడ్ చరిత్రను చేర్చు',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'మెరుగైన సూచనల కోసం ఇటీవల డౌన్‌లోడ్ చేసిన వీడియో శీర్షికలను AI తేలికపాటి సందర్భంగా ఉపయోగించనివ్వండి.',
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'నేను చూసిన ఛానళ్లను చేర్చు',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'మెరుగైన సూచనల కోసం మీ ఇటీవలి ఛానల్ చరిత్రను AI తేలికపాటి సందర్భంగా ఉపయోగించనివ్వండి.',
    'input.videoSuggestion.followUp.moreFromHistory':
      '"{{title}}" లాంటి మరిన్ని వీడియోలు',
    'input.videoSuggestion.followUp.channelFromHistory':
      '{{channel}}లాంటి ఛానళ్ల నుండి వీడియోలు',
  },
  th: {
    'input.videoSuggestion.savedToFolder': 'บันทึกไว้ในโฟลเดอร์ของคุณแล้ว',
    'input.videoSuggestion.tempFileAvailable': 'สำเนาชั่วคราวยังใช้งานได้อยู่',
    'input.videoSuggestion.localFileAvailable': 'ไฟล์พร้อมใช้งาน',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'รวมประวัติการดาวน์โหลดของฉัน',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'ให้ AI ใช้ชื่อวิดีโอที่คุณเพิ่งดาวน์โหลดเป็นบริบทแบบเบา ๆ เพื่อให้คำแนะนำดีขึ้น',
    'input.videoSuggestion.includeWatchedChannelsLabel': 'รวมช่องที่ฉันเคยดู',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'ให้ AI ใช้ประวัติช่องล่าสุดของคุณเป็นบริบทแบบเบา ๆ เพื่อให้คำแนะนำดีขึ้น',
    'input.videoSuggestion.followUp.moreFromHistory':
      'วิดีโอเพิ่มเติมแบบ "{{title}}"',
    'input.videoSuggestion.followUp.channelFromHistory':
      'วิดีโอจากช่องแบบ {{channel}}',
  },
  tl: {
    'input.videoSuggestion.savedToFolder': 'Na-save sa iyong folder',
    'input.videoSuggestion.tempFileAvailable': 'Available pa rin ang temp copy',
    'input.videoSuggestion.localFileAvailable': 'Available ang file',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'Isama ang history ng mga download ko',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'Payagan ang AI na gamitin ang mga pamagat ng mga video na na-download mo kamakailan bilang magaan na konteksto para sa mas magandang mungkahi.',
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'Isama ang mga channel na pinanood ko',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'Payagan ang AI na gamitin ang kamakailan mong history ng mga channel bilang magaan na konteksto para sa mas magandang mungkahi.',
    'input.videoSuggestion.followUp.moreFromHistory':
      'Mas maraming video na tulad ng "{{title}}"',
    'input.videoSuggestion.followUp.channelFromHistory':
      'Mga video mula sa mga channel na tulad ng {{channel}}',
  },
  tr: {
    'input.videoSuggestion.savedToFolder': 'Klasörünüze kaydedildi',
    'input.videoSuggestion.tempFileAvailable':
      'Geçici kopya hâlâ kullanılabilir',
    'input.videoSuggestion.localFileAvailable': 'Dosya kullanılabilir',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'İndirme geçmişimi dahil et',
    'input.videoSuggestion.includeDownloadHistoryHint':
      "Daha iyi öneriler için AI'nin son indirilen video başlıklarınızı hafif bağlam olarak kullanmasına izin verin.",
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'İzlediğim kanalları dahil et',
    'input.videoSuggestion.includeWatchedChannelsHint':
      "Daha iyi öneriler için AI'nin son kanal geçmişinizi hafif bağlam olarak kullanmasına izin verin.",
    'input.videoSuggestion.followUp.moreFromHistory':
      '"{{title}}" gibi daha fazla video',
    'input.videoSuggestion.followUp.channelFromHistory':
      '{{channel}} gibi kanallardan videolar',
  },
  uk: {
    'input.videoSuggestion.savedToFolder': 'Збережено у вашу папку',
    'input.videoSuggestion.tempFileAvailable':
      'Тимчасова копія все ще доступна',
    'input.videoSuggestion.localFileAvailable': 'Файл доступний',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'Додати мою історію завантажень',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'Дозволь ШІ використовувати назви нещодавно завантажених відео як легкий контекст для кращих рекомендацій.',
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'Додати канали, які я дивився',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'Дозволь ШІ використовувати вашу недавню історію каналів як легкий контекст для кращих рекомендацій.',
    'input.videoSuggestion.followUp.moreFromHistory':
      'Більше відео на кшталт "{{title}}"',
    'input.videoSuggestion.followUp.channelFromHistory':
      'Відео з каналів на кшталт {{channel}}',
  },
  ur: {
    'input.videoSuggestion.savedToFolder': 'آپ کے فولڈر میں محفوظ ہو گیا',
    'input.videoSuggestion.tempFileAvailable': 'عارضی نقل ابھی بھی دستیاب ہے',
    'input.videoSuggestion.localFileAvailable': 'فائل دستیاب ہے',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'میری ڈاؤن لوڈ ہسٹری شامل کریں',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'بہتر تجاویز کے لیے AI کو آپ کی حال ہی میں ڈاؤن لوڈ کی گئی ویڈیوز کے عنوانات ہلکے سیاق کے طور پر استعمال کرنے دیں۔',
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'میں نے جو چینلز دیکھے ہیں انہیں شامل کریں',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'بہتر تجاویز کے لیے AI کو آپ کی حالیہ چینل ہسٹری ہلکے سیاق کے طور پر استعمال کرنے دیں۔',
    'input.videoSuggestion.followUp.moreFromHistory':
      '"{{title}}" جیسی مزید ویڈیوز',
    'input.videoSuggestion.followUp.channelFromHistory':
      '{{channel}} جیسے چینلز کی ویڈیوز',
  },
  vi: {
    'input.videoSuggestion.savedToFolder': 'Đã lưu vào thư mục của bạn',
    'input.videoSuggestion.tempFileAvailable': 'Bản tạm vẫn còn dùng được',
    'input.videoSuggestion.localFileAvailable': 'Tệp đã sẵn sàng',
    'input.videoSuggestion.includeDownloadHistoryLabel':
      'Bao gồm lịch sử tải xuống của tôi',
    'input.videoSuggestion.includeDownloadHistoryHint':
      'Cho phép AI dùng tiêu đề các video bạn tải xuống gần đây làm ngữ cảnh nhẹ để gợi ý tốt hơn.',
    'input.videoSuggestion.includeWatchedChannelsLabel':
      'Bao gồm các kênh tôi đã xem',
    'input.videoSuggestion.includeWatchedChannelsHint':
      'Cho phép AI dùng lịch sử kênh gần đây của bạn làm ngữ cảnh nhẹ để gợi ý tốt hơn.',
    'input.videoSuggestion.followUp.moreFromHistory':
      'Thêm video giống "{{title}}"',
    'input.videoSuggestion.followUp.channelFromHistory':
      'Video từ các kênh như {{channel}}',
  },
  'zh-CN': {
    'input.videoSuggestion.savedToFolder': '已保存到你的文件夹',
    'input.videoSuggestion.tempFileAvailable': '临时副本仍可用',
    'input.videoSuggestion.localFileAvailable': '文件可用',
    'input.videoSuggestion.includeDownloadHistoryLabel': '包含我的下载历史',
    'input.videoSuggestion.includeDownloadHistoryHint':
      '让 AI 使用你最近下载过的视频标题作为轻量上下文，以获得更好的推荐。',
    'input.videoSuggestion.includeWatchedChannelsLabel': '包含我看过的频道',
    'input.videoSuggestion.includeWatchedChannelsHint':
      '让 AI 使用你最近的频道历史作为轻量上下文，以获得更好的推荐。',
    'input.videoSuggestion.followUp.moreFromHistory':
      '更多像 "{{title}}" 这样的视频',
    'input.videoSuggestion.followUp.channelFromHistory':
      '来自像 {{channel}} 这样频道的视频',
  },
  'zh-TW': {
    'input.videoSuggestion.savedToFolder': '已儲存到你的資料夾',
    'input.videoSuggestion.tempFileAvailable': '暫存副本仍可使用',
    'input.videoSuggestion.localFileAvailable': '檔案可用',
    'input.videoSuggestion.includeDownloadHistoryLabel': '包含我的下載歷史',
    'input.videoSuggestion.includeDownloadHistoryHint':
      '讓 AI 使用你最近下載過的影片標題作為輕量上下文，以獲得更好的推薦。',
    'input.videoSuggestion.includeWatchedChannelsLabel': '包含我看過的頻道',
    'input.videoSuggestion.includeWatchedChannelsHint':
      '讓 AI 使用你最近的頻道歷史作為輕量上下文，以獲得更好的推薦。',
    'input.videoSuggestion.followUp.moreFromHistory':
      '更多像 "{{title}}" 這樣的影片',
    'input.videoSuggestion.followUp.channelFromHistory':
      '來自像 {{channel}} 這樣頻道的影片',
  },
};

export default Object.fromEntries(
  Object.entries(baseOverrides).map(([langCode, overrides]) => [
    langCode,
    {
      ...(sourceGapOverrides[langCode] ?? {}),
      ...(sourceGapCleanupOverrides[langCode] ?? {}),
      ...overrides,
      ...(localeGapOverrides[langCode] ?? {}),
      ...(downloadFinishedOverrides[langCode] ?? {}),
      ...(videoSuggestionFollowUpOverrides[langCode] ?? {}),
      ...(videoSuggestionContextOverrides[langCode] ?? {}),
    },
  ])
);
