const mongoose = require("mongoose");

const blogPostSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    excerpt: { type: String, required: true, trim: true, maxlength: 500 },
    content: { type: String, required: true },
    coverImage: { type: String, default: "" },
    tags: [{ type: String, trim: true }],
    authorName: { type: String, required: true, trim: true },
    authorDesignation: { type: String, default: "", trim: true },
    authorImage: { type: String, default: "" },
    published: { type: Boolean, default: false },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

blogPostSchema.index({ published: 1, publishedAt: -1 });

module.exports = mongoose.model("BlogPost", blogPostSchema);
