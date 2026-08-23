// Hand-curated slang layer. THE ONLY FILE YOU EVER EDIT BY HAND.
//
// Rule: no coordinates live here. Ever. An alias maps a colloquial string to one
// or more canonical names that locations.generated.js already resolves from OSM.
// That way slang costs you zero coordinates and can never drift out of date.
//
// A one-to-many alias resolves to several points (the resolver returns all of
// them, plus their centroid if you only want one marker).

export const ALIASES = {
  // Left-bank Darnytskyi housing estates, the joke abbreviation.
  'ПОХ': ['Позняки', 'Осокорки', 'Харківський масив'],
  'Позняки-Осокорки': ['Позняки', 'Осокорки'],

  // Chornobyl exclusion zone. ЧЗВ is not a settlement, it is an area, so it is
  // an alias rather than a fake point.
  'ЧЗВ': ['Чорнобиль'],
  'Зона відчуження': ['Чорнобиль'],
  'ЧАЕС': ['Чорнобильська АЕС'],

  // Kyiv districts, short forms.
  'Соломянка': ['Солом’янський район'],
  'Дарниця': ['Дарницький район'],
  'Оболонь': ['Оболонський район'],
  'Поділ': ['Подільський район'],
  'Святошин': ['Святошинський район'],
  'Троєщина': ['Вигурівщина-Стара Дарниця'], // official name of the massif

  // Infrastructure that is NOT a settlement. Deliberately left commented out:
  // fill each one with the canonical OSM name that the audit prints, or delete
  // the key. Never guess a lat/lon here.
  // 'ТЕЦ-5': [],
  // 'ТЕЦ-6': [],
  // 'Трипільська ТЕС': [],
  // 'ДВРЗ': [],
};

// Words to strip before matching, so "с. Гора", "смт Калита" and "місто Бровари"
// all hit the same record.
export const TYPE_PREFIXES = [
  'місто', 'м.', 'село', 'с.', 'селище', 'смт', 'смт.',
  'селище міського типу', 'хутір', 'район', 'масив',
];
