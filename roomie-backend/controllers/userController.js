const User = require('./../models/userModel');
const catchAsync = require('./../utils/catchAsync');
const AppError = require('./../utils/appError');

const filterObj = (obj, ...allowedFields) => {
  const newObj = {};
  Object.keys(obj).forEach((el) => {
    if (allowedFields.includes(el)) {
      newObj[el] = obj[el]; // The same as: name = req.body.name
    }
  });
  return newObj;
}; //Array with the allowed arguments to be updated

exports.getAllUsers = catchAsync(async (req, res, next) => {
  const users = await User.find();

  // SEND RESPONSE
  res.status(200).json({
    status: 200,
    results: users.length,
    data: {
      users,
    },
  });
});

exports.getUser = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.params.id).populate({
    path: 'myListings',
    select:
      '_id title pictureCover city state country zip rent utilitiesIncl -owner',
  });

  if (!user) {
    return next(new AppError('No user found with that ID', 404));
  }

  res.status(200).json({
    status: 200,
    data: {
      user,
    },
  });
});

exports.updateMe = catchAsync(async (req, res, next) => {
  // 1) Create an error if the user tries to update the passwordChangedAt
  if (req.body.password | req.body.passwordConfirm) {
    return next(new AppError('This route is not for password updates.', 400));
  }
  // 2) Filtered out unwanted fields names that are not allowed to be updated
  const filteredBody = filterObj(
    req.body,
    'name',
    'email',
    'profilePicture',
    'about',
    'age',
    'college'
  );

  // 3) Update user document
  const updatedUser = await User.findByIdAndUpdate(req.user.id, filteredBody, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({ status: 'sucess', data: { user: updatedUser } });
});

exports.deleteMe = catchAsync(async (req, res, next) => {
  await User.findByIdAndUpdate(req.user.id, { active: false });

  res.status(204).json({ status: 'sucess', data: null });
});

// exports.createUser = (req, res) => {
//   res.status(500).json({
//     status: 500,
//     message: 'This route is not yet defined.',
//   });
// };

// exports.updateUser = (req, res) => {
//   res.status(500).json({
//     status: 500,
//     message: 'This route is not yet defined.',
//   });
// };

// exports.deleteUser = (req, res) => {
//   res.status(500).json({
//     status: 500,
//     message: 'This route is not yet defined.',
//   });
// };

// exports.getUserListings = (req, res) => {
//   res.status(500).json({
//     status: 500,
//     message: 'This route is not yet defined.',
//   });
// };
