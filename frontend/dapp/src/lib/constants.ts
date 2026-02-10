export interface TaxObligation {
  id: string;
  name: string;
  shortName: string;
  description: string;
  frequency: 'monthly' | 'quarterly' | 'annual';
  nextDeadline: string;
  status: 'pending' | 'completed' | 'overdue' | 'upcoming';
  urgency: 'low' | 'medium' | 'high';
}

export interface Jurisdiction {
  code: string;
  name: string;
  flag: string;
  active: boolean;
  description: string;
  reportFormats: string[];
  obligations: TaxObligation[];
}

export const JURISDICTIONS: Jurisdiction[] = [
  {
    code: 'US',
    name: 'United States',
    flag: '\u{1F1FA}\u{1F1F8}',
    active: true,
    description: 'IRS-compliant crypto tax reporting with Form 8949, Schedule D, and more.',
    reportFormats: ['Form 8949', 'Schedule D', 'Schedule 1'],
    obligations: [
      {
        id: 'us-8949',
        name: 'Form 8949 - Sales & Dispositions',
        shortName: 'Form 8949',
        description: 'Report every crypto sale, swap, or disposition with cost basis and gain/loss.',
        frequency: 'annual',
        nextDeadline: 'Apr 15, 2025',
        status: 'upcoming',
        urgency: 'medium',
      },
      {
        id: 'us-schedule-d',
        name: 'Schedule D - Capital Gains Summary',
        shortName: 'Schedule D',
        description: 'Summarize total capital gains and losses from Form 8949.',
        frequency: 'annual',
        nextDeadline: 'Apr 15, 2025',
        status: 'upcoming',
        urgency: 'medium',
      },
      {
        id: 'us-estimated',
        name: 'Estimated Tax Payment (Q1)',
        shortName: 'Est. Tax Q1',
        description: 'Quarterly estimated tax if you expect to owe $1,000+ in taxes.',
        frequency: 'quarterly',
        nextDeadline: 'Apr 15, 2025',
        status: 'pending',
        urgency: 'high',
      },
    ],
  },
  {
    code: 'EU',
    name: 'European Union',
    flag: '\u{1F1EA}\u{1F1FA}',
    active: true,
    description: 'DAC8-ready reporting for EU member states with MiCA compliance support.',
    reportFormats: ['DAC8 Report', 'Capital Gains Summary'],
    obligations: [
      {
        id: 'eu-dac8',
        name: 'DAC8 Crypto Asset Report',
        shortName: 'DAC8',
        description: 'Mandatory reporting directive for crypto-asset service providers and holders.',
        frequency: 'annual',
        nextDeadline: 'Jan 31, 2026',
        status: 'upcoming',
        urgency: 'low',
      },
      {
        id: 'eu-cgs',
        name: 'Capital Gains Summary',
        shortName: 'Cap. Gains',
        description: 'Annual summary of capital gains from digital asset dispositions.',
        frequency: 'annual',
        nextDeadline: 'Jun 30, 2025',
        status: 'upcoming',
        urgency: 'low',
      },
    ],
  },
  {
    code: 'BR',
    name: 'Brazil',
    flag: '\u{1F1E7}\u{1F1F7}',
    active: true,
    description: 'Receita Federal compliant with IN 1888 and DARF generation.',
    reportFormats: ['IN 1888', 'DARF', 'GCAP'],
    obligations: [
      {
        id: 'br-darf',
        name: 'DARF - Imposto sobre Ganho de Capital',
        shortName: 'DARF',
        description: 'Pagamento mensal de imposto sobre ganhos com cripto acima de R$35.000 em vendas no m\u00EAs.',
        frequency: 'monthly',
        nextDeadline: 'Feb 28, 2025',
        status: 'pending',
        urgency: 'high',
      },
      {
        id: 'br-gcap',
        name: 'GCAP - Ganhos de Capital',
        shortName: 'GCAP',
        description: 'Declara\u00E7\u00E3o anual de ganhos de capital em criptoativos no programa da Receita Federal.',
        frequency: 'annual',
        nextDeadline: 'Apr 30, 2025',
        status: 'upcoming',
        urgency: 'medium',
      },
      {
        id: 'br-in1888',
        name: 'IN 1888 - Informa\u00E7\u00F5es sobre Opera\u00E7\u00F5es',
        shortName: 'IN 1888',
        description: 'Relat\u00F3rio mensal obrigat\u00F3rio para opera\u00E7\u00F5es em exchanges nacionais acima de R$30.000.',
        frequency: 'monthly',
        nextDeadline: 'Feb 28, 2025',
        status: 'overdue',
        urgency: 'high',
      },
    ],
  },
  {
    code: 'UK',
    name: 'United Kingdom',
    flag: '\u{1F1EC}\u{1F1E7}',
    active: false,
    description: 'HMRC crypto tax guidance and Self Assessment support.',
    reportFormats: ['SA108', 'Capital Gains Summary'],
    obligations: [],
  },
  {
    code: 'JP',
    name: 'Japan',
    flag: '\u{1F1EF}\u{1F1F5}',
    active: false,
    description: 'NTA-compliant miscellaneous income reporting.',
    reportFormats: ['Kakutei Shinkoku'],
    obligations: [],
  },
  {
    code: 'AU',
    name: 'Australia',
    flag: '\u{1F1E6}\u{1F1FA}',
    active: false,
    description: 'ATO crypto capital gains and income tax reporting.',
    reportFormats: ['CGT Schedule', 'Income Summary'],
    obligations: [],
  },
  {
    code: 'CA',
    name: 'Canada',
    flag: '\u{1F1E8}\u{1F1E6}',
    active: false,
    description: 'CRA-compliant capital gains and business income reporting.',
    reportFormats: ['Schedule 3', 'T1 Summary'],
    obligations: [],
  },
  {
    code: 'CH',
    name: 'Switzerland',
    flag: '\u{1F1E8}\u{1F1ED}',
    active: false,
    description: 'Swiss wealth tax and income reporting for digital assets.',
    reportFormats: ['Wealth Declaration', 'Income Summary'],
    obligations: [],
  },
  {
    code: 'SG',
    name: 'Singapore',
    flag: '\u{1F1F8}\u{1F1EC}',
    active: false,
    description: 'IRAS guidance for digital token taxation.',
    reportFormats: ['Income Tax Return'],
    obligations: [],
  },
];
