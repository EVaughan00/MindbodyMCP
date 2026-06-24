import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Import all tools
import { getTeacherScheduleTool } from './tools/teacherSchedule.js';
import {
  getClassesTool,
  getClassDescriptionsTool,
  addClientToClassTool,
  removeClientFromClassTool,
  getWaitlistEntriesTool,
  substituteClassTeacherTool,
  getClassSchedulesTool,
  getClassVisitsTool,
} from './tools/classManagement.js';
import {
  getClientsTool,
  addClientTool,
  updateClientTool,
  getClientVisitsTool,
  getClientMembershipsTool,
  addClientArrivalTool,
  getClientAccountBalancesTool,
  getClientContractsTool,
  getClientServicesTool,
} from './tools/clientManagement.js';
import {
  getServicesTool,
  getPackagesTool,
  getProductsTool,
  checkoutShoppingCartTool,
  purchaseContractTool,
  getContractsTool,
  getSalesTool,
  getTransactionsTool,
  getSalesSummaryTool,
} from './tools/salesManagement.js';
import { classifyClientTool } from './tools/classification.js';
import {
  getSitesTool,
  getLocationsTool,
  getProgramsTool,
  getResourcesTool,
  getSessionTypesTool,
  getStaffTool,
  getActivationCodeTool,
} from './tools/siteManagement.js';
import {
  getStaffAppointmentsTool,
  addAppointmentTool,
  updateAppointmentTool,
  getBookableItemsTool,
  getActiveSessionTimesTool,
  getScheduleItemsTool,
} from './tools/appointmentManagement.js';
import {
  getEnrollmentsTool,
  addClientToEnrollmentTool,
  getClientEnrollmentsTool,
} from './tools/enrollmentManagement.js';

/**
 * The full list of tool definitions exposed by the server.
 * Shared by both the stdio/SSE CLI and the Vercel Streamable HTTP endpoint.
 */
export const toolDefinitions = [
  // Teacher/Staff Tools
  {
    name: 'getTeacherSchedule',
    description: "Get a teacher's class schedule for a specified date range",
    inputSchema: {
      type: 'object',
      properties: {
        teacherName: { type: 'string', description: 'The name of the teacher' },
        startDate: { type: 'string', description: 'Start date in YYYY-MM-DD format' },
        endDate: { type: 'string', description: 'End date in YYYY-MM-DD format' },
      },
      required: ['teacherName'],
    },
  },
  {
    name: 'getStaff',
    description: 'Get all staff members with optional filters',
    inputSchema: {
      type: 'object',
      properties: {
        staffIds: { type: 'array', items: { type: 'number' }, description: 'Specific staff IDs to retrieve' },
        filters: { type: 'array', items: { type: 'string' }, description: 'Filters to apply' },
        sessionTypeIds: { type: 'array', items: { type: 'number' }, description: 'Session type IDs' },
        locationIds: { type: 'array', items: { type: 'number' }, description: 'Location IDs' },
        startDateTime: { type: 'string', description: 'Start date/time in ISO format' },
      },
    },
  },
  // Class Management Tools
  {
    name: 'getClasses',
    description: 'Get all classes with filtering options',
    inputSchema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'Start date in YYYY-MM-DD format' },
        endDate: { type: 'string', description: 'End date in YYYY-MM-DD format' },
        locationIds: { type: 'array', items: { type: 'number' }, description: 'Location IDs to filter by' },
        classDescriptionIds: { type: 'array', items: { type: 'number' }, description: 'Class description IDs' },
        staffIds: { type: 'array', items: { type: 'number' }, description: 'Staff IDs to filter by' },
      },
    },
  },
  {
    name: 'getClassDescriptions',
    description: 'Get all class types/descriptions offered',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'getClassSchedules',
    description: 'Get class schedules (recurring class templates)',
    inputSchema: {
      type: 'object',
      properties: {
        locationIds: { type: 'array', items: { type: 'number' }, description: 'Location IDs' },
        classDescriptionIds: { type: 'array', items: { type: 'number' }, description: 'Class description IDs' },
        staffIds: { type: 'array', items: { type: 'number' }, description: 'Staff IDs' },
        programIds: { type: 'array', items: { type: 'number' }, description: 'Program IDs' },
      },
    },
  },
  {
    name: 'addClientToClass',
    description: 'Book a client into a class',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string', description: 'Client ID' },
        classId: { type: 'number', description: 'Class ID to book' },
        requirePayment: { type: 'boolean', description: 'Require payment (default true)' },
        waitlist: { type: 'boolean', description: 'Add to waitlist if full (default false)' },
      },
      required: ['clientId', 'classId'],
    },
  },
  {
    name: 'removeClientFromClass',
    description: "Cancel a client's class booking",
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string', description: 'Client ID' },
        classId: { type: 'number', description: 'Class ID' },
        lateCancel: { type: 'boolean', description: 'Mark as late cancel (default false)' },
      },
      required: ['clientId', 'classId'],
    },
  },
  {
    name: 'getWaitlistEntries',
    description: 'Get waitlist entries for classes',
    inputSchema: {
      type: 'object',
      properties: {
        classScheduleIds: { type: 'array', items: { type: 'number' }, description: 'Class schedule IDs' },
        classIds: { type: 'array', items: { type: 'number' }, description: 'Class IDs' },
        clientIds: { type: 'array', items: { type: 'string' }, description: 'Client IDs' },
      },
    },
  },
  {
    name: 'substituteClassTeacher',
    description: 'Substitute a teacher for a class',
    inputSchema: {
      type: 'object',
      properties: {
        classId: { type: 'number', description: 'Class ID' },
        originalTeacherId: { type: 'number', description: 'Original teacher ID' },
        substituteTeacherId: { type: 'number', description: 'Substitute teacher ID' },
        substituteTeacherName: { type: 'string', description: 'Substitute teacher name (optional)' },
      },
      required: ['classId', 'originalTeacherId', 'substituteTeacherId'],
    },
  },
  {
    name: 'getClassVisits',
    description: 'Get client visits/attendance for a specific class. Returns all clients who booked or attended the class, including sign-in status, late cancellations, and service information.',
    inputSchema: {
      type: 'object',
      properties: {
        classId: { type: 'number', description: 'The ID of the class to get visits for' },
        lastModifiedDate: { type: 'string', description: 'Only return visits modified after this date (YYYY-MM-DD format)' },
      },
      required: ['classId'],
    },
  },
  // Client Management Tools
  {
    name: 'getClients',
    description: 'Search and retrieve clients',
    inputSchema: {
      type: 'object',
      properties: {
        searchText: { type: 'string', description: 'Search text for client name/email/phone' },
        clientIds: { type: 'array', items: { type: 'string' }, description: 'Specific client IDs' },
        lastModifiedDate: { type: 'string', description: 'Get clients modified after this date' },
        isProspect: { type: 'boolean', description: 'Filter for prospects only' },
      },
    },
  },
  {
    name: 'addClient',
    description: 'Add a new client',
    inputSchema: {
      type: 'object',
      properties: {
        firstName: { type: 'string', description: 'First name' },
        lastName: { type: 'string', description: 'Last name' },
        email: { type: 'string', description: 'Email address' },
        mobilePhone: { type: 'string', description: 'Mobile phone' },
        birthDate: { type: 'string', description: 'Birth date in YYYY-MM-DD format' },
        addressLine1: { type: 'string', description: 'Street address' },
        city: { type: 'string', description: 'City' },
        state: { type: 'string', description: 'State/Province' },
        postalCode: { type: 'string', description: 'Postal code' },
        country: { type: 'string', description: 'Country' },
        emergencyContactName: { type: 'string', description: 'Emergency contact name' },
        emergencyContactPhone: { type: 'string', description: 'Emergency contact phone' },
        emergencyContactRelationship: { type: 'string', description: 'Emergency contact relationship' },
        sendAccountEmails: { type: 'boolean', description: 'Send account emails (default true)' },
        referredBy: { type: 'string', description: 'Referral source' },
      },
      required: ['firstName', 'lastName'],
    },
  },
  {
    name: 'updateClient',
    description: 'Update client information',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string', description: 'Client ID to update' },
        updates: {
          type: 'object',
          properties: {
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            email: { type: 'string' },
            mobilePhone: { type: 'string' },
            birthDate: { type: 'string' },
            addressLine1: { type: 'string' },
            city: { type: 'string' },
            state: { type: 'string' },
            postalCode: { type: 'string' },
            emergencyContactName: { type: 'string' },
            emergencyContactPhone: { type: 'string' },
            sendAccountEmails: { type: 'boolean' },
          },
        },
      },
      required: ['clientId', 'updates'],
    },
  },
  {
    name: 'getClientVisits',
    description: "Get client's visit/attendance history",
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string', description: 'Client ID' },
        startDate: { type: 'string', description: 'Start date in YYYY-MM-DD format' },
        endDate: { type: 'string', description: 'End date in YYYY-MM-DD format' },
      },
      required: ['clientId'],
    },
  },
  {
    name: 'getClientMemberships',
    description: "Get client's active memberships",
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string', description: 'Client ID' },
        locationId: { type: 'number', description: 'Location ID (optional)' },
      },
      required: ['clientId'],
    },
  },
  {
    name: 'addClientArrival',
    description: 'Check in a client (mark arrival)',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string', description: 'Client ID' },
        locationId: { type: 'number', description: 'Location ID' },
      },
      required: ['clientId', 'locationId'],
    },
  },
  {
    name: 'getClientAccountBalances',
    description: "Get client's account balances",
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string', description: 'Client ID' },
      },
      required: ['clientId'],
    },
  },
  {
    name: 'getClientContracts',
    description: "Get client's contracts/memberships, including TerminationDate (contract churn signal) and autoRenewing",
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string', description: 'Client ID' },
      },
      required: ['clientId'],
    },
  },
  {
    name: 'getClientServices',
    description: "Get a client's purchased services (intro offers, class packs). Each service is joined to the catalog for isIntroOffer; an active intro service means the client is a trialer. Set showActiveOnly=false to include recently-expired intros.",
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string', description: 'Client ID' },
        showActiveOnly: { type: 'boolean', description: 'Only active services (default true). Set false to include recently-lapsed intros.' },
      },
      required: ['clientId'],
    },
  },
  {
    name: 'classifyClient',
    description: "Classify a client's lifecycle stage: lead, trialer, member, lapsed (churned), external (3rd-party like ClassPass), or inactive. Mirrors RepFlow's rules. Returns the status plus the signals behind it. Use for 'what kind of client is X' questions.",
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string', description: 'Client ID' },
      },
      required: ['clientId'],
    },
  },
  // Sales & Commerce Tools
  {
    name: 'getServices',
    description: 'Get available services (class packages, memberships)',
    inputSchema: {
      type: 'object',
      properties: {
        programIds: { type: 'array', items: { type: 'number' }, description: 'Program IDs' },
        sessionTypeIds: { type: 'array', items: { type: 'number' }, description: 'Session type IDs' },
        locationId: { type: 'number', description: 'Location ID' },
        classId: { type: 'number', description: 'Class ID' },
        hideRelatedPrograms: { type: 'boolean', description: 'Hide related programs' },
      },
    },
  },
  {
    name: 'getPackages',
    description: 'Get class packages',
    inputSchema: {
      type: 'object',
      properties: {
        locationId: { type: 'number', description: 'Location ID' },
        classScheduleId: { type: 'number', description: 'Class schedule ID' },
      },
    },
  },
  {
    name: 'getProducts',
    description: 'Get retail products',
    inputSchema: {
      type: 'object',
      properties: {
        productIds: { type: 'array', items: { type: 'number' }, description: 'Product IDs' },
        searchText: { type: 'string', description: 'Search text' },
        categoryIds: { type: 'array', items: { type: 'string' }, description: 'Category IDs' },
        subCategoryIds: { type: 'array', items: { type: 'string' }, description: 'Subcategory IDs' },
        sellOnline: { type: 'boolean', description: 'Filter for online products' },
      },
    },
  },
  {
    name: 'getContracts',
    description: 'Get available contracts/memberships',
    inputSchema: {
      type: 'object',
      properties: {
        contractIds: { type: 'array', items: { type: 'number' }, description: 'Contract IDs' },
        soldOnline: { type: 'boolean', description: 'Filter for online contracts' },
        locationId: { type: 'number', description: 'Location ID' },
      },
    },
  },
  {
    name: 'checkoutShoppingCart',
    description: 'Process a shopping cart checkout',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string', description: 'Client ID' },
        items: {
          type: 'array',
          description: 'Cart items',
          items: {
            type: 'object',
            properties: {
              item: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['Service', 'Product', 'Package', 'Tip'] },
                  metadata: { type: 'object' },
                },
              },
              quantity: { type: 'number' },
            },
          },
        },
        payments: {
          type: 'array',
          description: 'Payment methods',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['Cash', 'Check', 'CreditCard', 'Comp', 'Custom', 'StoredCard'] },
              metadata: { type: 'object' },
            },
          },
        },
        inStore: { type: 'boolean', description: 'In-store purchase' },
        promotionCode: { type: 'string', description: 'Promotion code' },
        sendEmail: { type: 'boolean', description: 'Send email receipt' },
        locationId: { type: 'number', description: 'Location ID' },
      },
      required: ['clientId', 'items', 'payments'],
    },
  },
  {
    name: 'purchaseContract',
    description: 'Purchase a contract/membership',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string', description: 'Client ID' },
        contractId: { type: 'number', description: 'Contract ID' },
        startDate: { type: 'string', description: 'Start date in YYYY-MM-DD format' },
        firstPaymentOccurs: { type: 'string', enum: ['StartDate', 'UponSale', 'BillingDate'] },
        clientSignature: { type: 'string', description: 'Client signature' },
        promotionCode: { type: 'string', description: 'Promotion code' },
        locationId: { type: 'number', description: 'Location ID' },
      },
      required: ['clientId', 'contractId', 'startDate'],
    },
  },
  {
    name: 'getSalesSummary',
    description: "Aggregate revenue for a date window: { gross, collected, recurring, nonRecurring, salesCount }. Returns the metric, not the rows — use this for 'how much did we make' questions instead of getSales.",
    inputSchema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'Start date YYYY-MM-DD' },
        endDate: { type: 'string', description: 'End date YYYY-MM-DD' },
        revenueType: { type: 'string', enum: ['all', 'recurring', 'nonrecurring'], description: 'Filter the split (default all)' },
      },
      required: ['startDate', 'endDate'],
    },
  },
  {
    name: 'getSales',
    description: 'Get raw sales in a date window (gross value + what sold). Paginated/enveloped. Prefer getSalesSummary for metrics.',
    inputSchema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'Start date YYYY-MM-DD' },
        endDate: { type: 'string', description: 'End date YYYY-MM-DD' },
        pageSize: { type: 'number', description: 'Rows per page (max 200)' },
      },
      required: ['startDate', 'endDate'],
    },
  },
  {
    name: 'getTransactions',
    description: 'Get raw payment transactions in a date window (Amount + Settled = money actually collected). Use for reconciliation.',
    inputSchema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'Start date YYYY-MM-DD' },
        endDate: { type: 'string', description: 'End date YYYY-MM-DD' },
      },
      required: ['startDate', 'endDate'],
    },
  },
  // Site & Location Tools
  {
    name: 'getSites',
    description: 'Get site/business information',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'getLocations',
    description: 'Get all studio locations',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'getPrograms',
    description: 'Get programs (yoga, pilates, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        scheduleType: { type: 'string', enum: ['All', 'Class', 'Enrollment', 'Appointment'] },
        onlineOnly: { type: 'boolean', description: 'Online programs only' },
      },
    },
  },
  {
    name: 'getResources',
    description: 'Get resources (rooms, equipment)',
    inputSchema: {
      type: 'object',
      properties: {
        sessionTypeIds: { type: 'array', items: { type: 'number' }, description: 'Session type IDs' },
        locationId: { type: 'number', description: 'Location ID' },
        startDateTime: { type: 'string', description: 'Start date/time' },
        endDateTime: { type: 'string', description: 'End date/time' },
      },
    },
  },
  {
    name: 'getSessionTypes',
    description: 'Get session types (class types, appointment types)',
    inputSchema: {
      type: 'object',
      properties: {
        programIds: { type: 'array', items: { type: 'number' }, description: 'Program IDs' },
        onlineOnly: { type: 'boolean', description: 'Online sessions only' },
      },
    },
  },
  {
    name: 'getActivationCode',
    description: 'Get site activation code',
    inputSchema: { type: 'object', properties: {} },
  },
  // Appointment Tools
  {
    name: 'getStaffAppointments',
    description: 'Get staff appointments',
    inputSchema: {
      type: 'object',
      properties: {
        staffIds: { type: 'array', items: { type: 'number' }, description: 'Staff IDs' },
        locationIds: { type: 'array', items: { type: 'number' }, description: 'Location IDs' },
        startDate: { type: 'string', description: 'Start date in YYYY-MM-DD format' },
        endDate: { type: 'string', description: 'End date in YYYY-MM-DD format' },
        appointmentIds: { type: 'array', items: { type: 'number' }, description: 'Appointment IDs' },
        clientIds: { type: 'array', items: { type: 'string' }, description: 'Client IDs' },
      },
      required: ['staffIds'],
    },
  },
  {
    name: 'addAppointment',
    description: 'Book an appointment',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string', description: 'Client ID' },
        staffId: { type: 'number', description: 'Staff ID' },
        locationId: { type: 'number', description: 'Location ID' },
        sessionTypeId: { type: 'number', description: 'Session type ID' },
        startDateTime: { type: 'string', description: 'Start date/time in ISO format' },
        resourceIds: { type: 'array', items: { type: 'number' }, description: 'Resource IDs' },
        notes: { type: 'string', description: 'Appointment notes' },
        staffRequested: { type: 'boolean', description: 'Staff requested' },
        executePayment: { type: 'boolean', description: 'Execute payment' },
        sendEmail: { type: 'boolean', description: 'Send confirmation email' },
        applyPayment: { type: 'boolean', description: 'Apply payment' },
      },
      required: ['clientId', 'staffId', 'locationId', 'sessionTypeId', 'startDateTime'],
    },
  },
  {
    name: 'updateAppointment',
    description: 'Update an appointment',
    inputSchema: {
      type: 'object',
      properties: {
        appointmentId: { type: 'number', description: 'Appointment ID' },
        staffId: { type: 'number', description: 'Staff ID' },
        startDateTime: { type: 'string', description: 'Start date/time' },
        endDateTime: { type: 'string', description: 'End date/time' },
        resourceIds: { type: 'array', items: { type: 'number' }, description: 'Resource IDs' },
        notes: { type: 'string', description: 'Notes' },
        executePayment: { type: 'boolean', description: 'Execute payment' },
        sendEmail: { type: 'boolean', description: 'Send email' },
        applyPayment: { type: 'boolean', description: 'Apply payment' },
      },
      required: ['appointmentId'],
    },
  },
  {
    name: 'getBookableItems',
    description: 'Get available appointment slots',
    inputSchema: {
      type: 'object',
      properties: {
        sessionTypeIds: { type: 'array', items: { type: 'number' }, description: 'Session type IDs' },
        locationIds: { type: 'array', items: { type: 'number' }, description: 'Location IDs' },
        staffIds: { type: 'array', items: { type: 'number' }, description: 'Staff IDs' },
        startDate: { type: 'string', description: 'Start date' },
        endDate: { type: 'string', description: 'End date' },
        appointmentId: { type: 'number', description: 'Appointment ID for rescheduling' },
      },
      required: ['sessionTypeIds'],
    },
  },
  {
    name: 'getActiveSessionTimes',
    description: 'Get active session availability times',
    inputSchema: {
      type: 'object',
      properties: {
        scheduleType: { type: 'string', enum: ['All', 'Class', 'Enrollment', 'Appointment'] },
        sessionTypeIds: { type: 'array', items: { type: 'number' }, description: 'Session type IDs' },
        startTime: { type: 'string', description: 'Start time' },
        endTime: { type: 'string', description: 'End time' },
        days: { type: 'array', items: { type: 'string' }, description: 'Days of week' },
      },
    },
  },
  {
    name: 'getScheduleItems',
    description: 'Get schedule items/availability',
    inputSchema: {
      type: 'object',
      properties: {
        locationIds: { type: 'array', items: { type: 'number' }, description: 'Location IDs' },
        staffIds: { type: 'array', items: { type: 'number' }, description: 'Staff IDs' },
        startDate: { type: 'string', description: 'Start date' },
        endDate: { type: 'string', description: 'End date' },
        ignorePrepFinishBuffer: { type: 'boolean', description: 'Ignore prep/finish buffer' },
      },
    },
  },
  // Enrollment Tools
  {
    name: 'getEnrollments',
    description: 'Get enrollments (courses, workshops, series)',
    inputSchema: {
      type: 'object',
      properties: {
        locationIds: { type: 'array', items: { type: 'number' }, description: 'Location IDs' },
        classScheduleIds: { type: 'array', items: { type: 'number' }, description: 'Class schedule IDs' },
        staffIds: { type: 'array', items: { type: 'number' }, description: 'Staff IDs' },
        programIds: { type: 'array', items: { type: 'number' }, description: 'Program IDs' },
        sessionTypeIds: { type: 'array', items: { type: 'number' }, description: 'Session type IDs' },
        semesterIds: { type: 'array', items: { type: 'number' }, description: 'Semester IDs' },
        courseIds: { type: 'array', items: { type: 'number' }, description: 'Course IDs' },
        startDate: { type: 'string', description: 'Start date' },
        endDate: { type: 'string', description: 'End date' },
      },
    },
  },
  {
    name: 'addClientToEnrollment',
    description: 'Register client for course/workshop',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string', description: 'Client ID' },
        classScheduleIds: { type: 'array', items: { type: 'number' }, description: 'Class schedule IDs' },
        enrollmentDateForward: { type: 'string', description: 'Enrollment date forward' },
        enrollmentDates: { type: 'array', items: { type: 'string' }, description: 'Specific enrollment dates' },
        enroll: { type: 'boolean', description: 'Enroll (default true)' },
        waitlist: { type: 'boolean', description: 'Add to waitlist' },
        sendEmail: { type: 'boolean', description: 'Send confirmation email' },
        testMode: { type: 'boolean', description: 'Test mode' },
      },
      required: ['clientId', 'classScheduleIds'],
    },
  },
  {
    name: 'getClientEnrollments',
    description: "Get client's enrollments",
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string', description: 'Client ID' },
      },
      required: ['clientId'],
    },
  },
];

/** Dispatch a tool call by name. Runs inside the active tenant context. */
export async function callTool(name: string, args: any): Promise<any> {
  switch (name) {
    case 'getTeacherSchedule':
      return getTeacherScheduleTool(args.teacherName, args.startDate, args.endDate);
    case 'getStaff':
      return getStaffTool(args.staffIds, args.filters, args.sessionTypeIds, args.locationIds, args.startDateTime);
    case 'getClasses':
      return getClassesTool(args.startDate, args.endDate, args.locationIds, args.classDescriptionIds, args.staffIds);
    case 'getClassDescriptions':
      return getClassDescriptionsTool();
    case 'getClassSchedules':
      return getClassSchedulesTool(args.locationIds, args.classDescriptionIds, args.staffIds, args.programIds);
    case 'addClientToClass':
      return addClientToClassTool(args.clientId, args.classId, args.requirePayment, args.waitlist);
    case 'removeClientFromClass':
      return removeClientFromClassTool(args.clientId, args.classId, args.lateCancel);
    case 'getWaitlistEntries':
      return getWaitlistEntriesTool(args.classScheduleIds, args.classIds, args.clientIds);
    case 'substituteClassTeacher':
      return substituteClassTeacherTool(args.classId, args.originalTeacherId, args.substituteTeacherId, args.substituteTeacherName);
    case 'getClassVisits':
      return getClassVisitsTool(args.classId, args.lastModifiedDate);
    case 'getClients':
      return getClientsTool(args.searchText, args.clientIds, args.lastModifiedDate, args.isProspect);
    case 'addClient':
      return addClientTool(
        args.firstName, args.lastName, args.email, args.mobilePhone, args.birthDate,
        args.addressLine1, args.city, args.state, args.postalCode, args.country,
        args.emergencyContactName, args.emergencyContactPhone, args.emergencyContactRelationship,
        args.sendAccountEmails, args.referredBy
      );
    case 'updateClient':
      return updateClientTool(args.clientId, args.updates);
    case 'getClientVisits':
      return getClientVisitsTool(args.clientId, args.startDate, args.endDate);
    case 'getClientMemberships':
      return getClientMembershipsTool(args.clientId, args.locationId);
    case 'addClientArrival':
      return addClientArrivalTool(args.clientId, args.locationId);
    case 'getClientAccountBalances':
      return getClientAccountBalancesTool(args.clientId);
    case 'getClientContracts':
      return getClientContractsTool(args.clientId);
    case 'getClientServices':
      return getClientServicesTool(args.clientId, args.showActiveOnly);
    case 'classifyClient':
      return classifyClientTool(args.clientId);
    case 'getServices':
      return getServicesTool(args.programIds, args.sessionTypeIds, args.locationId, args.classId, args.hideRelatedPrograms);
    case 'getPackages':
      return getPackagesTool(args.locationId, args.classScheduleId);
    case 'getProducts':
      return getProductsTool(args.productIds, args.searchText, args.categoryIds, args.subCategoryIds, args.sellOnline);
    case 'getContracts':
      return getContractsTool(args.contractIds, args.soldOnline, args.locationId);
    case 'checkoutShoppingCart':
      return checkoutShoppingCartTool(args.clientId, args.items, args.payments, args.inStore, args.promotionCode, args.sendEmail, args.locationId);
    case 'purchaseContract':
      return purchaseContractTool(args.clientId, args.contractId, args.startDate, args.firstPaymentOccurs, args.clientSignature, args.promotionCode, args.locationId);
    case 'getSalesSummary':
      return getSalesSummaryTool(args.startDate, args.endDate, args.revenueType);
    case 'getSales':
      return getSalesTool(args.startDate, args.endDate, args.pageSize);
    case 'getTransactions':
      return getTransactionsTool(args.startDate, args.endDate);
    case 'getSites':
      return getSitesTool();
    case 'getLocations':
      return getLocationsTool();
    case 'getPrograms':
      return getProgramsTool(args.scheduleType, args.onlineOnly);
    case 'getResources':
      return getResourcesTool(args.sessionTypeIds, args.locationId, args.startDateTime, args.endDateTime);
    case 'getSessionTypes':
      return getSessionTypesTool(args.programIds, args.onlineOnly);
    case 'getActivationCode':
      return getActivationCodeTool();
    case 'getStaffAppointments':
      return getStaffAppointmentsTool(args.staffIds, args.locationIds, args.startDate, args.endDate, args.appointmentIds, args.clientIds);
    case 'addAppointment':
      return addAppointmentTool(
        args.clientId, args.staffId, args.locationId, args.sessionTypeId, args.startDateTime,
        args.resourceIds, args.notes, args.staffRequested, args.executePayment, args.sendEmail, args.applyPayment
      );
    case 'updateAppointment':
      return updateAppointmentTool(
        args.appointmentId, args.staffId, args.startDateTime, args.endDateTime,
        args.resourceIds, args.notes, args.executePayment, args.sendEmail, args.applyPayment
      );
    case 'getBookableItems':
      return getBookableItemsTool(args.sessionTypeIds, args.locationIds, args.staffIds, args.startDate, args.endDate, args.appointmentId);
    case 'getActiveSessionTimes':
      return getActiveSessionTimesTool(args.scheduleType, args.sessionTypeIds, args.startTime, args.endTime, args.days);
    case 'getScheduleItems':
      return getScheduleItemsTool(args.locationIds, args.staffIds, args.startDate, args.endDate, args.ignorePrepFinishBuffer);
    case 'getEnrollments':
      return getEnrollmentsTool(
        args.locationIds, args.classScheduleIds, args.staffIds, args.programIds, args.sessionTypeIds,
        args.semesterIds, args.courseIds, args.startDate, args.endDate
      );
    case 'addClientToEnrollment':
      return addClientToEnrollmentTool(
        args.clientId, args.classScheduleIds, args.enrollmentDateForward, args.enrollmentDates,
        args.enroll, args.waitlist, args.sendEmail, args.testMode
      );
    case 'getClientEnrollments':
      return getClientEnrollmentsTool(args.clientId);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/**
 * Build a fully-configured MCP server (tool list + call dispatch).
 * Transport is attached by the caller (stdio, SSE, or Streamable HTTP).
 */
export function createMcpServer(): Server {
  const server = new Server(
    {
      name: process.env.MCP_SERVER_NAME || 'mindbody-mcp',
      version: process.env.MCP_SERVER_VERSION || '2.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await callTool(name, (args || {}) as any);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  });

  return server;
}
