export const errorResponse = ({ code = "unknown", message = "Unknown error.", details = {} }) => {
  return {
    ok: false,
    error: {
      code,
      message,
      details
    }
  };
};

export const validationError = ({ message = "Validation failed.", details = {} } = {}) => {
  return errorResponse({
    code: "validation_error",
    message,
    details
  });
};

export const conflictError = ({ message = "Conflict detected.", details = {} } = {}) => {
  return errorResponse({
    code: "conflict",
    message,
    details
  });
};

export const authError = ({ message = "Authentication failed.", details = {} } = {}) => {
  return errorResponse({
    code: "auth_error",
    message,
    details
  });
};

export const notFoundError = ({ message = "Not found.", details = {} } = {}) => {
  return errorResponse({
    code: "not_found",
    message,
    details
  });
};

export const readOnlyError = ({ message = "Server is read-only.", details = {} } = {}) => {
  return errorResponse({
    code: "read_only",
    message,
    details
  });
};

export const opnsenseError = ({ message = "OPNsense API request failed.", details = {} } = {}) => {
  return errorResponse({
    code: "opnsense_error",
    message,
    details
  });
};

export const timeoutError = ({ message = "Request timed out.", details = {} } = {}) => {
  return errorResponse({
    code: "timeout",
    message,
    details
  });
};

export const unknownError = ({ message = "Unexpected error.", details = {} } = {}) => {
  return errorResponse({
    code: "unknown",
    message,
    details
  });
};

export const toMcpResult = ({ payload }) => {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ],
    structuredContent: payload,
    isError: payload?.ok === false
  };
};
