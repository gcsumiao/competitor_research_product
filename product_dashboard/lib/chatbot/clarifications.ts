type Clarification = {
  answer: string
  bullets: string[]
}

const CLARIFICATIONS: Array<{ pattern: RegExp; payload: Clarification }> = [
  {
    pattern: /(how.*revenue.*estimate|actual.*estimate|helium\s*10)/i,
    payload: {
      answer:
        "Revenue in this dashboard is estimate-driven for market coverage, with Innova/BLCKTEC adjustments applied where those adjusted report snapshots are available.",
      bullets: [
        "Market-wide values are estimated from monthly competitor report workbooks.",
        "Innova/BLCKTEC figures can differ between standard and adjusted workbooks when actual inputs are applied.",
        "Always compare metrics within the same report mode for consistency.",
      ],
    },
  },
  {
    pattern: /(why.*(jump|drop|higher|lower)|why.*share)/i,
    payload: {
      answer:
        "Large share moves can happen even when brand revenue is stable, because share is relative to the total market in that month.",
      bullets: [
        "If market size contracts faster than your brand, your share can rise without revenue growth.",
        "If market expands and your brand grows slower, share can decline despite absolute growth.",
        "Seasonality (for example, post-holiday normalization) can amplify this effect.",
      ],
    },
  },
  {
    pattern: /(what.*included.*other|other brand|other tools)/i,
    payload: {
      answer:
        "The 'Other' grouping captures brands or tool types outside the primary named segments and brand-focused breakouts.",
      bullets: [
        "For brand views, it includes long-tail competitors not surfaced as top brand callouts.",
        "For type views, it includes non-tablet/non-handheld/non-dongle groupings.",
        "Use the scope filters to inspect segment-specific contributions.",
      ],
    },
  },
  {
    pattern: /(difference.*adjusted|adjusted.*standard|innova adjusted)/i,
    payload: {
      answer:
        "Adjusted reports incorporate manual/actual corrections for key brands, while standard competitor analysis is purely pipeline-derived.",
      bullets: [
        "Adjusted mode is typically preferred for stakeholder decisions on Innova/BLCKTEC performance.",
        "Standard mode is useful for broad market comparability when adjustments are unavailable.",
        "Mixing adjusted and standard snapshots can create apparent discontinuities.",
      ],
    },
  },
  {
    pattern: /(difference.*1p.*3p|what.*1p|what.*3p)/i,
    payload: {
      answer:
        "1P and 3P represent first-party vs third-party fulfillment/seller channels for Amazon listings.",
      bullets: [
        "1P: Amazon-retail style relationship and fulfillment pipeline.",
        "3P: Marketplace sellers operating on Amazon.",
        "If channel fields are absent in a snapshot, the split is reported as unavailable instead of inferred.",
      ],
    },
  },
]

export function getClarification(message: string): Clarification | null {
  for (const item of CLARIFICATIONS) {
    if (item.pattern.test(message)) {
      return item.payload
    }
  }
  return null
}
