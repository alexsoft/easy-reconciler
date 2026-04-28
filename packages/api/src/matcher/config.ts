const numEnv = (key: string, def: number) => (process.env[key] ? Number(process.env[key]) : def);
const intEnv = (key: string, def: number) => (process.env[key] ? parseInt(process.env[key]!, 10) : def);
const strArrEnv = (key: string, def: string[]) =>
  process.env[key] ? process.env[key]!.split(',').map((s) => s.trim()) : def;

export const matcherConfig = {
  confidence: {
    autoConfirm: numEnv('MATCHER_AUTO_CONFIRM', 0.95),
    propose: numEnv('MATCHER_PROPOSE', 0.7),
  },
  amountToleranceCents: intEnv('MATCHER_AMOUNT_TOLERANCE_CENTS', 2),
  overpayment: {
    pctThreshold: numEnv('MATCHER_OVERPAY_PCT', 0.05),
    absThresholdCents: intEnv('MATCHER_OVERPAY_ABS_CENTS', 500),
  },
  dateWindow: {
    daysBeforeIssue: intEnv('MATCHER_DAYS_BEFORE_ISSUE', 7),
    daysAfterIssue: intEnv('MATCHER_DAYS_AFTER_ISSUE', 60),
  },
  fuzzyRef: {
    maxLevenshtein: intEnv('MATCHER_FUZZY_LEV', 2),
  },
  customerName: {
    jaroWinklerThreshold: numEnv('MATCHER_JW_THRESHOLD', 0.88),
  },
  subsetSum: {
    maxInvoices: intEnv('MATCHER_SUBSET_MAX_INVOICES', 5),
    maxCandidates: intEnv('MATCHER_SUBSET_MAX_CANDIDATES', 64),
  },
  ruleConfidence: {
    exactRef: numEnv('MATCHER_CONF_EXACT_REF', 1.0),
    descriptionRef: numEnv('MATCHER_CONF_DESC_REF', 0.95),
    fuzzyRef: numEnv('MATCHER_CONF_FUZZY_REF', 0.85),
    nameAmountDate: numEnv('MATCHER_CONF_NAME', 0.8),
    subsetSum: numEnv('MATCHER_CONF_SUBSET', 0.75),
    creditNoteNet: numEnv('MATCHER_CONF_CREDIT', 0.8),
    payoutLink: numEnv('MATCHER_CONF_PAYOUT', 0.95),
  },
  noiseKeywords: strArrEnv('MATCHER_NOISE_KEYWORDS', [
    'salary',
    'payroll out',
    'rent',
    'landlord',
    'fee',
    'bank charge',
    'tax authority',
    'refund out',
  ]),
} as const;

export type MatcherConfig = typeof matcherConfig;
