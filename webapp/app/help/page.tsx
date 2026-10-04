import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "עזרה – איך מחושבת הזדמנות · CodeWizard",
  description:
    "הסבר מלא על מנגנון הניקוד: סינון רלוונטיות משרות, ניקוד חברה, שערי ההטבה וחוזה ההזדמנות",
};

/* ------------------------------------------------------------------ *
 * Scoring tables. These mirror agents/jobs_intel/engine/scoring.py
 * (score_company) and job_sources.py (classify). Keep them in sync.
 * ------------------------------------------------------------------ */

type Factor = { code: string; points: string; condition: string };

const COMPANY_FACTORS: Factor[] = [
  { code: "baseline", points: "0.15", condition: "נקודת התחלה קבועה לכל חברה שנסרקה" },
  { code: "named", points: "+0.18", condition: "החברה יש שם, והיא לא מסומנת needs-verification" },
  { code: "domain", points: "+0.10", condition: "אחרת: יש לה דומיין (במקום ה-0.18)" },
  { code: "devopsStack", points: "+0.14", condition: "tech_stack חותך את רשימת DEVOPS_STACK" },
  { code: "cloud", points: "+0.05", condition: "tech_stack חותך את aws / azure / gcp" },
  { code: "k8s", points: "+0.05", condition: "דגל k8s מופעל (kubernetes / k8s / openshift)" },
  { code: "hiringVolume", points: "+0.16", condition: "3 משרות DevOps/IT פתוחות או יותר" },
  { code: "hiringVolume", points: "+0.12", condition: "2 משרות פתוחות במקביל" },
  { code: "hiringVolume", points: "+0.06", condition: "משרה פתוחה אחת" },
  { code: "seniorRole", points: "+0.14", condition: "senior / lead / head בכותרת או בתגיות" },
  { code: "recency", points: "+0.14", condition: "פורסם לפני 7 ימים או פחות" },
  { code: "recency", points: "+0.06", condition: "פורסם לפני 21 ימים או פחות" },
  { code: "urgency", points: "+0.08", condition: "מילות דחיפות בטקסט: פתוח / דחוף / urgent / asap / hiring" },
  { code: "contact", points: "+0.10", condition: "קיים איש קשר לגיוס (person_name או contact)" },
];

const ROLE_TERMS: [string, string][] = [
  ["devops", "0.55"],
  ["dev ops", "0.55"],
  ["devsecops", "0.55"],
  ["site reliability", "0.50"],
  ["sre", "0.50"],
  ["platform engineer", "0.50"],
  ["platform engineering", "0.45"],
  ["infrastructure engineer", "0.45"],
  ["cloud engineer", "0.45"],
  ["cloud infrastructure", "0.40"],
  ["release engineer", "0.35"],
  ["systems engineer", "0.30"],
  ["system administrator", "0.30"],
  ["sysadmin", "0.30"],
  ["build engineer", "0.30"],
];

const TOOL_TERMS: [string, string][] = [
  ["kubernetes", "0.25"],
  ["k8s", "0.25"],
  ["terraform", "0.22"],
  ["gitops", "0.22"],
  ["argocd", "0.20"],
  ["ci/cd", "0.20"],
  ["cicd", "0.20"],
  ["observability", "0.20"],
  ["prometheus", "0.20"],
  ["grafana", "0.20"],
  ["openshift", "0.20"],
  ["docker", "0.18"],
  ["ansible", "0.18"],
  ["jenkins", "0.18"],
  ["helm", "0.18"],
  ["aws", "0.15"],
  ["eks", "0.15"],
  ["gke", "0.15"],
  ["cloudformation", "0.15"],
  ["pulumi", "0.15"],
  ["datadog", "0.15"],
  ["istio", "0.15"],
  ["github actions", "0.15"],
  ["gitlab ci", "0.15"],
  ["azure", "0.12"],
  ["gcp", "0.12"],
  ["linux", "0.12"],
  ["networking", "0.10"],
  ["cloud", "0.10"],
];

const GATES = [
  {
    key: "MIN_OPPORTUNITY_CONFIDENCE",
    value: "0.65",
    title: "סף ביטחון",
    body: "ה-confidence של החברה חייב להגיע ל-0.65 לפחות. מתחת לזו ההזדמנות לא נוצרת בכלל.",
  },
  {
    key: "REQUIRE_WHY_NOW",
    value: "true",
    title: "למה עכשיו מוכח",
    body: "חייב להיות לפחות אות אחד עם occurred_at – כלומר תאריך. אות ללא תאריך לא יוכיח מתי דבר קרה.",
  },
  {
    key: "REQUIRE_EVIDENCE",
    value: "true",
    title: "ראיה מקפה",
    body: "חייב להיות לפחות אות אחד עם url. החריג היחיד: חברה מזוהה עם שם, שם מותר לעבור בלי קישור.",
  },
];

const CONTRACT = [
  { k: "who", v: "מי זו החברה, ומי איש הקשר בה" },
  { k: "what", v: "מה קורה – כמה תפקידים ובאיזה סטאק" },
  { k: "why_now", v: "מה הטריגר, עם תאריך" },
  { k: "pain", v: "הכאב הסתום שאנחנו מנסים לפתור" },
  { k: "context", v: "דומיין, קבוצות, איש קשר" },
  { k: "approach", v: "הצעת הגישה לפי סוג השירות" },
  { k: "opening_question", v: "שאלת פתיחה מוכנה לשליחה" },
];

export default function HelpPage() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h2 className="page-title">עזרה – איך מחושבת הזדמנות?</h2>
        <p className="page-sub">
          כל נקודת ביטחון במערכת ניתן לשייך לגורם מנומן בשם. הדף הזה מסביר את
          כל הגורמים, את השערים, ודוגמה מלאה לחישוב.
        </p>
      </div>

      <div className="help-toc">
        <span className="help-toc-label">בתוכן:</span>
        <a href="#flow">הזרימה הכוללת</a>
        <a href="#jobs">שלב 1 – סינון משרות</a>
        <a href="#company">שלב 2 – ניקוד חברה</a>
        <a href="#example">דוגמת חישוב</a>
        <a href="#gates">שלב 3 – שערי ההטבה</a>
        <a href="#contract">חוזה ההזדמנות</a>
        <a href="#metrics">מדדים נוספים</a>
        <a href="#caveats">מצב נוכחי</a>
      </div>

      {/* ---------------------------------------------------------------- */}
      <h3 className="section-title" id="flow">הזרימה הכוללת</h3>
      <div className="card help-flow">
        <div className="help-step">
          <span className="help-step-n">1</span>
          <div>
            <strong>סינון רלוונטיות לכל משרה</strong>
            <div className="help-step-sub">
              צבירת משרות מכל המקורות, וסינון ל- <code>is_devops</code> — כן/לא. בשלב
              הזה אין ניקוד, רק סינון.
            </div>
          </div>
        </div>
        <div className="help-step">
          <span className="help-step-n">2</span>
          <div>
            <strong>ניקוד חברה</strong>
            <div className="help-step-sub">
              חישוב <code>confidence</code> בטווח 0–0.97 מתוך 10 גורמים.
            </div>
          </div>
        </div>
        <div className="help-step">
          <span className="help-step-n">3</span>
          <div>
            <strong>שערי ההטבה</strong>
            <div className="help-step-sub">
              שלושה תנאים שחייבים להתקיים יחד. אם אחד נכשל — ההזדמנות לא נוצרת.
            </div>
          </div>
        </div>
        <div className="help-step">
          <span className="help-step-n">4</span>
          <div>
            <strong>בניית חוזה ההזדמנות</strong>
            <div className="help-step-sub">
              שבעה שדות מוכנים לפעולה, כולל שאלת פתיחה. דורש סדר לפי confidence.
            </div>
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      <h3 className="section-title" id="jobs">
        שלב 1 – סינון רלוונטיות משרה (<code>is_devops</code>)
      </h3>
      <p>
        כל משרה נסרקת מול שתי רשימות מילים. הופעה ב<strong>כותרת המשרה</strong> נותנת
        את המשקל המלא; הופעה ב<strong>גוף תיאור המשרה</strong> נותנת את אותו משקל
        כפול 0.4 — כלומר <code>BODY_DISCOUNT</code>.
      </p>

      <div className="help-two-col">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ROLE_TERMS — תפקיד</th>
                <th>משקל</th>
              </tr>
            </thead>
            <tbody>
              {ROLE_TERMS.map(([term, w]) => (
                <tr key={`r-${term}`}>
                  <td><code>{term}</code></td>
                  <td className="help-num">{w}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>TOOL_TERMS — סטאק</th>
                <th>משקל</th>
              </tr>
            </thead>
            <tbody>
              {TOOL_TERMS.map(([term, w]) => (
                <tr key={`t-${term}`}>
                  <td><code>{term}</code></td>
                  <td className="help-num">{w}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="help-formula">
        <code>is_devops = title_role or role_body &gt;= 0.70</code>
      </div>

      <div className="help-callout help-callout-key">
        <strong>הכלל החשוב ביותר: כלי לבדו לעולם אינם מקדמים משרה ל-DevOps.</strong>
        <p>
          השער קורא את <code>role_body</code> — ולא את הסכום המשולב. הסיבה: כל משרה
          ב-ATS מסתיימת ברשימת טכנולוגיות קבועה. משרה כמו
          <em> Senior Software Engineer</em> עם <code>aws + azure + gcp + kubernetes
          + ci/cd</code> בתיאור שלה הייתה עוברת את סף 0.60 בטעות — ולכן המערכת
          מסווגת אותה כלא-DevOps. כלי נותן נקודות <strong>לדרוג</strong> בלבד.
        </p>
        <p>
          לכן אנחנו מסירים את פסקת השיווק בראש התיאור לפני הניקוד
          (<code>_desc_and_body</code>), ואת התיאור המלא שומרים לתצוגה.
        </p>
      </div>

      {/* ---------------------------------------------------------------- */}
      <h3 className="section-title" id="company">
        שלב 2 – ניקוד חברה (<code>confidence</code>)
      </h3>
      <p>
        הניקוד <strong>מצטבר</strong>: מתחיל מ-0.15 וכל גורם שמתקיים מוסיף נקודות.
        התוצאה נחתכת לטווח 0–0.97. כל גורם שהפעיל נקודות נרשם ב-{" "}
        <code>reasons[]</code> עם התווית שלו, כדי שההסבר יהיה קריא לאדם ולא
        קופסה שחורה.
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>גורם</th>
              <th>נקודות</th>
              <th>תנאי</th>
            </tr>
          </thead>
          <tbody>
            {COMPANY_FACTORS.map((f, i) => (
              <tr key={`${f.code}-${i}`}>
                <td><code>{f.code}</code></td>
                <td className="help-num help-pts">{f.points}</td>
                <td>{f.condition}</td>
              </tr>
            ))}
            <tr className="help-total-row">
              <td><strong>תקרת הציון</strong></td>
              <td className="help-num help-pts"><strong>0.97</strong></td>
              <td>
                הסכום המרבי הוא 1.19 ולכן נחתך. ציון 0.97 = ביטחון מלא.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="help-callout">
        <strong>דיוק בטוקנים.</strong>
        <p>
          ההתאמה היא התאמה מילולית מדויקת (<code>s in DEVOPS_STACK</code>). הקלט
          חייב להיות <code>aws</code>, <code>k8s</code> וכו׳ — באנגלית קטנה. אם מקור
          הנתונים כותב <em>Amazon Web Services</em> או <em>Kubernetes</em> עם K
          גדולה, הגורם לא יפעל והניקוד ייפחת ב-0.14.
        </p>
      </div>

      {/* ---------------------------------------------------------------- */}
      <h3 className="section-title" id="example">דוגמת חישוב מלאה</h3>
      <p>
        חברה מזוהה בשם, עם <code>tech_stack = [kubernetes, terraform]</code>, מתג{" "}
        <code>k8s</code> פעיל, 2 משרות פתוחות, אות אחד פורסם לפני 12 ימים עם איש
        קשר, ללא מילות דחיפות.
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>גורם</th>
              <th>בדיקה</th>
              <th>נקודות</th>
              <th>סה"כ</th>
            </tr>
          </thead>
          <tbody>
            <tr><td><code>baseline</code></td><td>תמיד</td><td className="help-num">0.15</td><td className="help-num help-run">0.15</td></tr>
            <tr><td><code>named</code></td><td>יש שם, לא needs-verification</td><td className="help-num">+0.18</td><td className="help-num help-run">0.33</td></tr>
            <tr><td><code>devopsStack</code></td><td>kubernetes ∈ DEVOPS_STACK</td><td className="help-num">+0.14</td><td className="help-num help-run">0.47</td></tr>
            <tr><td><code>cloud</code></td><td>terraform ∉ aws/azure/gcp</td><td className="help-num muted">לא הופעל</td><td className="help-num help-run">0.47</td></tr>
            <tr><td><code>k8s</code></td><td>דגל k8s פעיל</td><td className="help-num">+0.05</td><td className="help-num help-run">0.52</td></tr>
            <tr><td><code>hiringVolume</code></td><td>2 משרות פתוחות</td><td className="help-num">+0.12</td><td className="help-num help-run">0.64</td></tr>
            <tr><td><code>seniorRole</code></td><td>senior/lead/head</td><td className="help-num">+0.14</td><td className="help-num help-run">0.78</td></tr>
            <tr><td><code>recency</code></td><td>12 ימים ≤ 21</td><td className="help-num">+0.06</td><td className="help-num help-run">0.84</td></tr>
            <tr><td><code>urgency</code></td><td>אין מילות דחיפות</td><td className="help-num muted">לא הופעל</td><td className="help-num help-run">0.84</td></tr>
            <tr><td><code>contact</code></td><td>יש איש קשר</td><td className="help-num">+0.10</td><td className="help-num help-run">0.94</td></tr>
            <tr className="help-total-row">
              <td colSpan={3}><strong>confidence סופי</strong></td>
              <td className="help-num help-run"><strong>0.94</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="help-callout help-callout-ok">
        <strong>התוצאה: 0.94</strong> — עובר את סף 0.65. אם יש לה אות עם תאריך
        ואות עם קישור, נוצרת הזדמנות מלאה עם priority של 94.
      </div>

      <div className="help-callout help-callout-no">
        <strong>דוגמה נגדית — נדחית.</strong>
        <p>
          חברה מסומנת <code>needs-verification</code>, <code>tech_stack =
          [docker]</code>, משרה פתוחה אחת, אות מלפני 40 יום, בלי איש קשר ובלי
          קישור:
        </p>
        <div className="help-formula help-formula-inline">
          0.15 + 0.10 (domain) + 0.14 (docker) + 0.06 (משרה אחת) = <strong>0.45</strong>
        </div>
        <p>
          <strong>0.45 &lt; 0.65 → נדחה.</strong> ובנוסף היא הייתה נכשלת גם בשער{" "}
          <code>REQUIRE_EVIDENCE</code> (אין קישור).
        </p>
      </div>

      {/* ---------------------------------------------------------------- */}
      <h3 className="section-title" id="gates">
        שלב 3 – שערי ההטבה
      </h3>
      <p>
        גם עם confidence מלא, ההזדמנות לא נוצרת אם אחד משלושת השערים נכשל. כל שלושה
        ניתנים לשינוי דרך משתני סביבה.
      </p>
      <div className="help-gates">
        {GATES.map((g) => (
          <div className="help-gate" key={g.key}>
            <div className="help-gate-head">
              <code>{g.key}</code>
              <span className="badge badge-blue">{g.value}</span>
            </div>
            <strong>{g.title}</strong>
            <p>{g.body}</p>
          </div>
        ))}
      </div>

      {/* ---------------------------------------------------------------- */}
      <h3 className="section-title" id="contract">
        חוזה ההזדמנות
      </h3>
      <p>
        הזדמנות שעברה את כל השערים נבנית לשבעה שדות מוכנים לפעולה. ה-{" "}
        <code>pain</code> וה-{" "}<code>approach</code> נבחרים לפי סוג השירות
        שהוגדר עבור החברה.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>שדה</th><th>תוכן</th></tr>
          </thead>
          <tbody>
            {CONTRACT.map((c) => (
              <tr key={c.k}>
                <td><code>{c.k}</code></td>
                <td>{c.v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---------------------------------------------------------------- */}
      <h3 className="section-title" id="metrics">
        מדדים נוספים
      </h3>
      <div className="card">
        <p style={{ margin: 0 }}>
          <code>platform_fit</code> הוא מדד <em>נפרד</em> מה-confidence, בטווח 0–1.
          הוא שיעור הסטאק של החברה שנכלל ב-{" "}<code>DEVOPS_STACK</code>. למשל{" "}
          <code>tech_stack = [aws, kubernetes, some-saas]</code> נותן 0.67. הוא
          מחושב ונשמר, אך <strong>כיום אינו משפיע על ה-confidence ואינו מוצג בממשק</strong>{" "}
          — הוא מדד ניטרלי לעיון ידני.
        </p>
      </div>

      {/* ---------------------------------------------------------------- */}
      <h3 className="section-title" id="caveats">
        מצב נוכחי — למה כדאי לדעת
      </h3>
      <div className="help-callout help-callout-warn">
        <p>
          <strong>1. ההזדמנויות המוצגות כרגע במערכת הן נתוני הדגמה, לא פלט של הסקור.</strong>{" "}
          מזהותיהן <code>opp-001</code>, האיש קשר הוא נתון לדוגמה, וה-{" "}
          <code>priority</code> שלהן לא תואם את החישוב. הסקור האמיתי מעולם לא הפיק
          שורת הזדמנות אחת.
        </p>
        <p>
          <strong>2. שני השלבים מנותקים.</strong> סריקת חברות ה-ATS כותבת לטבלת{" "}
          <code>devops_jobs</code> בלבד, ולא יוצרת <code>signals</code> ולכן
          <em> אינה</em> מרימה את ה-confidence של אף הזדמנות בפועל.
        </p>
        <p>
          <strong>3. מדד <code>platform_fit</code> לא נצרך.</strong> הוא נכתב ל-DB
          אך אינו נקרא על ידי אף חלק במערכת.
        </p>
      </div>

      <div className="help-footer-nav">
        <Link href="/opportunities" className="btn btn-secondary">
          ← חזרה להזדמנויות
        </Link>
        <Link href="/agents" className="btn btn-secondary">
        סוכנים ומקורות ←
        </Link>
      </div>
    </div>
  );
}