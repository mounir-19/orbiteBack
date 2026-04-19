const Joi = require('joi');
const registerSchema = Joi.object({
    first_name: Joi.string().max(100).required(),
    last_name: Joi.string().max(100).required(),
    email: Joi.string().email().required(),
    phone: Joi.string().max(30).required(),
    password: Joi.string().min(8).required(),
    role: Joi.string().valid('student', 'expert', 'client').required(),
    domain: Joi.string().valid('web_dev', 'mobile_dev', 'ui_ux_design', 'video_editing', 'other').when('role', {
        is: Joi.valid('student', 'expert'),
        then: Joi.required(),
        otherwise: Joi.optional(),
    }),
    wilaya: Joi.string().max(100).optional(),
    university: Joi.string().max(255).optional(),
    cv_url: Joi.string().uri().optional(),
    portfolio_url: Joi.string().uri().optional(),
    specialty: Joi.string().max(255).optional(),
    bio: Joi.string().optional(),
    company: Joi.string().max(255).optional(),
    city: Joi.string().max(100).optional(),
});

const loginSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
});

const changePasswordSchema = Joi.object({
    current_password: Joi.string().required(),
    new_password: Joi.string().min(8).required(),
});
//  PROJECTS
const createProjectSchema = Joi.object({
    title: Joi.string().max(255).required(),
    service_type: Joi.string().valid('web_dev', 'mobile_dev', 'ui_ux_design', 'video_editing', 'other').required(),
    description: Joi.string().required(),
    team_size: Joi.number().integer().min(1).optional(),
});

const updateProjectSchema = Joi.object({
    title: Joi.string().max(255).optional(),
    description: Joi.string().optional(),
    status: Joi.string().valid('under_review', 'accepted', 'in_progress', 'in_review', 'delivered', 'rejected', 'cancelled').optional(),
    total_price: Joi.number().positive().optional(),
    team_size: Joi.number().integer().min(1).optional(),
    expert_notes: Joi.string().optional(),
    started_at: Joi.date().iso().optional(),
    delivered_at: Joi.date().iso().optional(),
});
//  TASKS
const createTaskSchema = Joi.object({
    title: Joi.string().max(255).required(),
    description: Joi.string().optional(),
    weight_pct: Joi.number().positive().max(100).required(),
    commit_freq: Joi.string().valid('daily', 'every_two_days', 'weekly').optional(),
    due_date: Joi.date().iso().optional(),
    domain_tag: Joi.string().valid('web_dev', 'mobile_dev', 'ui_ux_design', 'video_editing', 'other').optional(),
    student_id: Joi.string().uuid().optional(),
    ai_proposed: Joi.boolean().optional(),
});

const updateTaskSchema = Joi.object({
    title: Joi.string().max(255).optional(),
    description: Joi.string().optional(),
    weight_pct: Joi.number().positive().max(100).optional(),
    status: Joi.string().valid('open', 'in_progress', 'in_review', 'completed', 'blocked').optional(),
    commit_freq: Joi.string().valid('daily', 'every_two_days', 'weekly').optional(),
    due_date: Joi.date().iso().optional(),
    student_id: Joi.string().uuid().optional(),
});

const bulkCreateTasksSchema = Joi.object({
    tasks: Joi.array().items(createTaskSchema).min(1).required(),
});
//  APPLICATIONS
const createApplicationSchema = Joi.object({
    message: Joi.string().optional(),
});

const updateApplicationSchema = Joi.object({
    status: Joi.string().valid('selected', 'rejected', 'withdrawn').required(),
});
//  INTERVIEWS
const createInterviewSchema = Joi.object({
    student_id: Joi.string().uuid().required(),
    scheduled_at: Joi.date().iso().required(),
    meeting_link: Joi.string().uri().optional(),
});

const updateInterviewSchema = Joi.object({
    scheduled_at: Joi.date().iso().optional(),
    meeting_link: Joi.string().uri().optional(),
    status: Joi.string().valid('scheduled', 'completed', 'cancelled', 'rescheduled').optional(),
    result: Joi.string().valid('admitted', 'rejected', 'pending').optional(),
    comment: Joi.string().optional(),
});
//  RATINGS
const createRatingSchema = Joi.object({
    student_id: Joi.string().uuid().required(),
    project_id: Joi.string().uuid().required(),
    quality: Joi.number().min(0).max(10).required(),
    deadline: Joi.number().min(0).max(10).required(),
    communication: Joi.number().min(0).max(10).required(),
    collaboration: Joi.number().min(0).max(10).required(),
    technical: Joi.number().min(0).max(10).required(),
    comment: Joi.string().optional(),
});
//  PAYMENTS
const createPaymentSchema = Joi.object({
    project_id: Joi.string().uuid().required(),
    recipient_id: Joi.string().uuid().required(),
    recipient_type: Joi.string().valid('student', 'expert', 'referral').required(),
    amount: Joi.number().positive().required(),
    method: Joi.string().valid('baridimob', 'ccp', 'bank_transfer', 'cash').required(),
    transaction_ref: Joi.string().optional(),
});

const updatePaymentSchema = Joi.object({
    status: Joi.string().valid('processed', 'failed', 'refunded').required(),
    transaction_ref: Joi.string().optional(),
    processed_at: Joi.date().iso().optional(),
});
//  REFERRALS
const createReferralSchema = Joi.object({
    client_contact: Joi.string().max(255).required(),
    bonus_amount: Joi.number().positive().optional(),
});

const updateReferralSchema = Joi.object({
    status: Joi.string().valid('converted', 'rejected', 'bonus_paid').required(),
    project_id: Joi.string().uuid().optional(),
    bonus_amount: Joi.number().positive().optional(),
});
//  ENROLLMENT PROOF
const enrollmentProofSchema = Joi.object({
    academic_year: Joi.string().pattern(/^\d{4}-\d{4}$/).required(),
    document_url: Joi.string().uri().required(),
});
//  AI
const taskBreakdownSchema = Joi.object({
    project_id: Joi.string().uuid().required(),
    scope_summary: Joi.string().min(20).required(),
    team_size: Joi.number().integer().min(1).required(),
    deadline: Joi.string().optional(),
    domain: Joi.string().valid('web_dev', 'mobile_dev', 'ui_ux_design', 'video_editing', 'other').required(),
});

const teamMatchingSchema = Joi.object({
    project_id: Joi.string().uuid().required(),
});

const approveAiTasksSchema = Joi.object({
    tasks: Joi.array().items(Joi.object({
        title: Joi.string().required(),
        description: Joi.string().optional(),
        weight_pct: Joi.number().positive().max(100).required(),
        commit_freq: Joi.string().valid('daily', 'every_two_days', 'weekly').optional(),
        due_date: Joi.date().iso().optional(),
        domain_tag: Joi.string().valid('web_dev', 'mobile_dev', 'ui_ux_design', 'video_editing', 'other').optional(),
        student_id: Joi.string().uuid().optional(),
    })).min(1).required(),
});

const approveTeamSchema = Joi.object({
    selected_student_ids: Joi.array().items(Joi.string().uuid()).min(1).required(),
});
//  VALIDATE HELPER
const validate = (schema) => (req, res, next) => {
    const { error } = schema.validate(req.body, { abortEarly: false });
    if (error) {
        return res.status(400).json({
            error: 'Validation failed',
            details: error.details.map(d => d.message),
        });
    }
    next();
};

module.exports = {
    validate,
    registerSchema,
    loginSchema,
    changePasswordSchema,
    createProjectSchema,
    updateProjectSchema,
    createTaskSchema,
    updateTaskSchema,
    bulkCreateTasksSchema,
    createApplicationSchema,
    updateApplicationSchema,
    createInterviewSchema,
    updateInterviewSchema,
    createRatingSchema,
    createPaymentSchema,
    updatePaymentSchema,
    createReferralSchema,
    updateReferralSchema,
    enrollmentProofSchema,
    taskBreakdownSchema,
    teamMatchingSchema,
    approveAiTasksSchema,
    approveTeamSchema,
};