const crypto = require('crypto');
const { promisify } = require('util'); //To make a function return a promisse
const jwt = require('jsonwebtoken');
const User = require('./../models/userModel');
const catchAsync = require('./../utils/catchAsync');
const AppError = require('./../utils/appError');
const sendEmail = require('./../utils/email.js');

const signToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

const createSendToken = (user, statusCode, res) => {
  const token = signToken(user._id);

  res.status(statusCode).json({
    status: 'sucess',
    token, //Sending the token back to the client
    data: {
      user: user,
    },
  });
};

exports.signup = catchAsync(async (req, res, next) => {
  const newUser = await User.create({
    name: req.body.name,
    email: req.body.email,
    password: req.body.password,
    passwordConfirm: req.body.passwordConfirm,
    profilePicture: req.body.profilePicture,
    favoriteListings: req.body.favoriteListings,
    college: req.body.college,
    age: req.body.age,
    about: req.body.about,
    myListings: req.body.myListings,
    // passwordChangedAt: req.body.passwordChangedAt,
    // passwordResetToken: req.body.passwordResetToken,
    // passwordResetExpires: req.body.passwordResetExpires,
  });

  createSendToken(newUser, 201, res);
});

exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  // 1) Check if e-mail and password was submited
  if (!email || !password) {
    return next(new AppError('Please provide email and password', 400));
  }

  // 2) Check if user eists && password is correct
  const user = await User.findOne({ email }).select('+password'); //+"name_of_field" to show passwords that we defined to not show up with "select: false" in the Schema

  if (!user || !(await user.correctPassword(password, user.password))) {
    return next(new AppError('Incorrect emmail or password', 401));
  }
  // 3) If everything ok, send token to client
  createSendToken(user, 200, res);
});

exports.protect = catchAsync(async (req, res, next) => {
  // 1) Getting token and check if it's there
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) {
    return next(new AppError('You are not logged in! Please log in.', 401));
  }

  // 2) Verification token (If someone manupulated the data or if the token is expired)
  const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET); //Returns the payload, the IAT and EXP from token OR "JsonWebTokenError" if token is invalid

  // 3) Check if user still exists
  const currentUser = await User.findById(decoded.id);

  if (!currentUser) {
    return next(new AppError('The user to this token does not exist.', 401));
  }

  // 4)Check if user changed password after the token was issued
  if (currentUser.changePasswordAfter(decoded.iat)) {
    //Since "currentUser" is a document, I can use the instance method on it ("changePasswordAfter");
    return next(
      new AppError(
        'The user recently changed password. Please log in again!',
        401
      )
    );
  }

  //Grant access to protected route
  req.user = currentUser; //Sending all the user info on the REQUEST to be used in the future
  next();
});

exports.restrictTo = (...roles) => {
  //Closure necessary because I can't pass argument through middlewares functions
  return (req, res, next) => {
    //roles is an array
    if (!roles.includes(req.user.role)) {
      return next(
        new AppError('You do not have permission to perform this action', 403)
      );
    }
    next();
  };
};

exports.forgotPassword = catchAsync(async (req, res, next) => {
  // 1) Get user based on POSTed email address
  const user = await User.findOne({ email: req.body.email });

  if (!user) {
    return next(new AppError('There is no user with email address', 404));
  }

  // 2) Generate the ramdom reset token and
  const resetToken = user.createPasswordResetToken(); //Calling this function will modify the data, but not save it
  // That is why we need to "update" the document, by calling user.save below:

  await user.save({ validateBeforeSave: false }); //Deactivate the validators on my users Schema

  // 3) Send it to user's e-mail
  const resetURL = `${req.protocol}://${req.get(
    'host'
  )}/api/v1/users/resetPassword/${resetToken}`; //Send the original token (not the encrypted)

  const message = `Forgot your password? Submit a PATCH request with your new password and passwordConfirm to: ${resetURL}.\nIf you dind't, please ignore this email.`;

  try {
    await sendEmail({
      email: user.email,
      subject: 'Your Password Reset Token (Valid for 10min',
      message,
    });

    res.status(200).json({ status: 'sucess', message: 'Token sent to email' });
  } catch (err) {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });

    return next(new AppError('There was an error sending the email', 500));
  }
});

exports.resetPassword = catchAsync(async (req, res, next) => {
  // 1) Get user based on the token
  // Encrypt the token given with the encrypted version stored in the DB
  const hashedToken = crypto
    .createHash('sha256')
    .update(req.params.token)
    .digest('hex');

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() }, //If the token has expired, it will not return the user
  });

  // 2) If token has not expired, and there is a user : Set the new passwordResetExpires
  if (!user) {
    return next(
      new AppError('Sorry, the token has expired. Request a new token!', 400)
    );
  }

  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;

  //All above only MODIFY the document. We need to save it, by calling this:

  await user.save();

  // 3) Update passwordChangedAt property for the user

  // 4) Log the user in, send JWT
  createSendToken(user, 200, res);
});

exports.updatePassword = catchAsync(async (req, res, next) => {
  // 1) Get the user from collection
  const user = await User.findById(req.user._id).select('+password'); //Since the user ill be already logged in, the id in in the "req" (line:98)

  // 2) Check if posted current password is correctPassword
  if (!(await user.correctPassword(req.body.currentPassword, user.password))) {
    return next(new AppError('Sorry, your current password is incorrect', 400));
  }

  // 3) If so, update password
  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;
  await user.save();

  // 4) Log user in, send JWT
  createSendToken(user, 200, res);
});
