/**
 * Seed marketing blog posts for UtthanAI (idempotent: skips if any post exists).
 * Run: node scripts/seedBlogs.js
 * Requires MONGO_URI in .env
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), override: true });

const mongoose = require("mongoose");
const BlogPost = require("../models/BlogPost");

const posts = [
  {
    title: "Why holistic student growth matters more than grades alone",
    slug: "why-holistic-student-growth-matters",
    excerpt:
      "Schools that connect academics, wellbeing, and skills see clearer signals for guidance—and parents stay aligned with the classroom.",
    content: `Grades tell part of the story. When schools also track engagement, skills, and wellbeing in one place, teachers and counsellors can spot patterns earlier and support each learner with context—not guesswork.

UtthanAI is built around this idea: one platform where roster, portfolios, and parent communication share the same source of truth. Leaders get cohort-level visibility without asking teams to maintain parallel spreadsheets.

**What changes in practice**
- Fewer “surprise” conversations at PTMs because trends are visible over time.
- Clearer handoffs between class teachers, counsellors, and admins.
- Parents see progress in language that matches what the school values—not only marks.

If you are evaluating edtech for your institution, ask whether the tool reduces noise for staff while increasing clarity for families. That is the bar we design for.`,
    coverImage:
      "https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1200&q=80",
    tags: ["education", "holistic", "schools"],
    authorName: "UtthanAI Team",
    authorDesignation: "Product & learning design",
    authorImage: "",
    published: true,
    publishedAt: new Date("2026-03-01T10:00:00Z"),
  },
  {
    title: "How AI can support teachers—without replacing judgment",
    slug: "ai-supports-teachers-not-replacement",
    excerpt:
      "Responsible AI in schools means summaries, nudges, and cohort views that save time while educators stay in charge of decisions.",
    content: `Artificial intelligence works best in schools when it handles repetition and surfacing—not final calls on a child’s future.

UtthanAI uses AI to help teams **see** patterns across classes: who might need a check-in, which cohorts are thriving, where attendance and engagement diverge. The teacher, counsellor, or principal still decides what to do next.

**Principles we follow**
1. **Human in the loop** — AI suggests; people choose.
2. **Transparency** — Schools control what data is used and who can see it.
3. **India-ready operations** — Flows respect verification, subscriptions, and how Indian institutions actually run day to day.

When piloting any AI feature, ask: does this reduce admin load and protect student dignity? If yes, it belongs in the product. If no, we leave it out.`,
    coverImage:
      "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?auto=format&fit=crop&w=1200&q=80",
    tags: ["ai", "teachers", "edtech"],
    authorName: "UtthanAI Team",
    authorDesignation: "Research & safety",
    authorImage: "",
    published: true,
    publishedAt: new Date("2026-03-15T14:00:00Z"),
  },
  {
    title: "From trial to trust: onboarding your school on UtthanAI",
    slug: "onboarding-your-school-utthanai",
    excerpt:
      "Registration, verification, and subscription flows that keep admins in control while families get access at the right time.",
    content: `Getting a whole school onto a new platform is as much about process as it is about software.

UtthanAI separates **registration** from **go-live**: your institution applies, platform admins verify details, and only then do school admins receive full access. That protects schools and families from incomplete setups.

**Tips for a smooth rollout**
- Nominate one school admin owner for roster and billing.
- Plan a short window to activate pending students after subscription payment—parents receive access when you intend them to.
- Use the subscription dashboard to align seat counts with your active roster.

We are here to support institutions that want a serious, long-term partner—not a one-off app download.`,
    coverImage:
      "https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1200&q=80",
    tags: ["onboarding", "schools", "India"],
    authorName: "UtthanAI Team",
    authorDesignation: "Customer success",
    authorImage: "",
    published: true,
    publishedAt: new Date("2026-04-01T09:00:00Z"),
  },
  {
    title: "Parent engagement that matches how modern schools work",
    slug: "parent-engagement-modern-schools",
    excerpt:
      "When parents see the same signals teachers use—without overwhelming noise—trust and follow-through improve.",
    content: `Parent apps often fail for one of two reasons: too little useful information, or so many alerts that families tune out.

UtthanAI focuses on **shared context**: attendance, assignments, and growth narratives that line up with what the school already tracks internally. Parents are not guessing; they are aligned.

**Outcomes we hear from early adopters**
- Fewer reactive calls to the office.
- Better attendance on days after transparent communication.
- Students feel supported when home and school speak the same language.

Engagement is not “more notifications.” It is the right information at the right time—and respect for every family’s attention.`,
    coverImage:
      "https://images.unsplash.com/photo-1497633762265-9d179a990aa6?auto=format&fit=crop&w=1200&q=80",
    tags: ["parents", "communication", "engagement"],
    authorName: "UtthanAI Team",
    authorDesignation: "Community",
    authorImage: "",
    published: true,
    publishedAt: new Date("2026-04-10T11:30:00Z"),
  },
];

async function run() {
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI missing");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  const n = await BlogPost.countDocuments();
  if (n > 0) {
    console.log(`BlogPost collection already has ${n} document(s). Skipping seed.`);
    await mongoose.disconnect();
    process.exit(0);
  }
  await BlogPost.insertMany(posts);
  console.log(`Seeded ${posts.length} blog posts.`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
