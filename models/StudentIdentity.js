const mongoose = require("mongoose");

const studentIdentitySchema = new mongoose.Schema(
  {
    parentUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: true }
);

studentIdentitySchema.index({ parentUserId: 1, name: 1 });

module.exports = mongoose.model("StudentIdentity", studentIdentitySchema);

