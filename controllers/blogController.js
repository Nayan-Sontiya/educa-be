const mongoose = require("mongoose");
const BlogPost = require("../models/BlogPost");

function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function ensureUniqueSlug(base, excludeId = null) {
  let slug = base || "post";
  let n = 0;
  for (;;) {
    const q = { slug };
    if (excludeId) q._id = { $ne: excludeId };
    const exists = await BlogPost.findOne(q).select("_id").lean();
    if (!exists) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
}

function toPublicDoc(doc) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(o._id),
    slug: o.slug,
    title: o.title,
    excerpt: o.excerpt,
    content: o.content,
    coverImage: o.coverImage || "",
    tags: o.tags || [],
    authorName: o.authorName,
    authorDesignation: o.authorDesignation || "",
    authorImage: o.authorImage || "",
    publishedAt: o.publishedAt,
    updatedAt: o.updatedAt,
  };
}

/** GET /api/blogs — published only */
exports.listPublished = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(30, Math.max(1, parseInt(req.query.limit, 10) || 9));
    const tag = typeof req.query.tag === "string" ? req.query.tag.trim() : "";
    const filter = { published: true };
    if (tag) filter.tags = tag;

    const [items, total] = await Promise.all([
      BlogPost.find(filter)
        .sort({ publishedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      BlogPost.countDocuments(filter),
    ]);

    const data = items.map((o) => ({
      id: String(o._id),
      slug: o.slug,
      title: o.title,
      excerpt: o.excerpt,
      coverImage: o.coverImage || "",
      tags: o.tags || [],
      authorName: o.authorName,
      authorDesignation: o.authorDesignation || "",
      authorImage: o.authorImage || "",
      publishedAt: o.publishedAt,
    }));

    return res.json({
      data,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (err) {
    console.error("listPublished:", err);
    return res.status(500).json({ message: err.message || "Failed to list blogs" });
  }
};

/** GET /api/blogs/slug/:slug */
exports.getBySlug = async (req, res) => {
  try {
    const slug = String(req.params.slug || "").trim().toLowerCase();
    if (!slug) return res.status(400).json({ message: "Slug required" });

    const doc = await BlogPost.findOne({ slug, published: true }).lean();

    if (!doc) return res.status(404).json({ message: "Post not found" });

    return res.json({ data: toPublicDoc(doc) });
  } catch (err) {
    console.error("getBySlug:", err);
    return res.status(500).json({ message: err.message || "Failed to load post" });
  }
};

/** GET /api/blogs/admin/all */
exports.listAllAdmin = async (req, res) => {
  try {
    const items = await BlogPost.find({}).sort({ updatedAt: -1 }).lean();
    return res.json({
      data: items.map((o) => ({
        ...toPublicDoc(o),
        published: o.published,
        createdAt: o.createdAt,
      })),
    });
  } catch (err) {
    console.error("listAllAdmin:", err);
    return res.status(500).json({ message: err.message || "Failed to list posts" });
  }
};

/** POST /api/blogs */
exports.create = async (req, res) => {
  try {
    const {
      title,
      slug: slugIn,
      excerpt,
      content,
      coverImage,
      tags,
      authorName,
      authorDesignation,
      authorImage,
      published,
    } = req.body;

    if (!title || !excerpt || !content || !authorName) {
      return res.status(400).json({ message: "title, excerpt, content, and authorName are required" });
    }

    const base = slugify(slugIn || title);
    const slug = await ensureUniqueSlug(base);

    const pub = Boolean(published);
    const doc = await BlogPost.create({
      title: String(title).trim(),
      slug,
      excerpt: String(excerpt).trim(),
      content: String(content),
      coverImage: typeof coverImage === "string" ? coverImage.trim() : "",
      tags: Array.isArray(tags) ? tags.map((t) => String(t).trim()).filter(Boolean) : [],
      authorName: String(authorName).trim(),
      authorDesignation: typeof authorDesignation === "string" ? authorDesignation.trim() : "",
      authorImage: typeof authorImage === "string" ? authorImage.trim() : "",
      published: pub,
      publishedAt: pub ? new Date() : null,
    });

    return res.status(201).json({ data: toPublicDoc(doc) });
  } catch (err) {
    console.error("blog create:", err);
    if (err.code === 11000) return res.status(409).json({ message: "Slug already exists" });
    return res.status(500).json({ message: err.message || "Create failed" });
  }
};

/** PUT /api/blogs/:id */
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "Invalid id" });

    const doc = await BlogPost.findById(id);
    if (!doc) return res.status(404).json({ message: "Post not found" });

    const {
      title,
      slug: slugIn,
      excerpt,
      content,
      coverImage,
      tags,
      authorName,
      authorDesignation,
      authorImage,
      published,
    } = req.body;

    if (title != null) doc.title = String(title).trim();
    if (excerpt != null) doc.excerpt = String(excerpt).trim();
    if (content != null) doc.content = String(content);
    if (coverImage != null) doc.coverImage = String(coverImage).trim();
    if (tags != null) doc.tags = Array.isArray(tags) ? tags.map((t) => String(t).trim()).filter(Boolean) : [];
    if (authorName != null) doc.authorName = String(authorName).trim();
    if (authorDesignation != null) doc.authorDesignation = String(authorDesignation).trim();
    if (authorImage != null) doc.authorImage = String(authorImage).trim();

    if (slugIn != null && String(slugIn).trim()) {
      const base = slugify(slugIn);
      doc.slug = await ensureUniqueSlug(base, doc._id);
    }

    if (published !== undefined) {
      const pub = Boolean(published);
      if (pub && !doc.published) doc.publishedAt = new Date();
      if (!pub) doc.publishedAt = null;
      doc.published = pub;
    }

    await doc.save();
    return res.json({ data: toPublicDoc(doc) });
  } catch (err) {
    console.error("blog update:", err);
    if (err.code === 11000) return res.status(409).json({ message: "Slug already exists" });
    return res.status(500).json({ message: err.message || "Update failed" });
  }
};

/** DELETE /api/blogs/:id */
exports.remove = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "Invalid id" });
    const r = await BlogPost.deleteOne({ _id: id });
    if (r.deletedCount === 0) return res.status(404).json({ message: "Post not found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("blog remove:", err);
    return res.status(500).json({ message: err.message || "Delete failed" });
  }
};
