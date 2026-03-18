import awsmobile from "../aws-export";

const apiUrl = awsmobile.aws_backend_api_url;

/**
 * Helper: Get the currently selected tenant ID from sessionStorage.
 * This is set by TenantContext when user selects a tenant.
 * @returns {string|null} Selected tenant ID or null
 */
const getSelectedTenantId = () => {
  try {
    const stored = sessionStorage.getItem('selectedTenant');
    if (stored) {
      return JSON.parse(stored).id || null;
    }
  } catch {
    // ignore parse errors
  }
  return null;
};

/**
 * Helper: Build standard request headers including Authorization and optional X-Tenant-Id.
 * @returns {Object} Headers object
 */
const getHeaders = () => {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: localStorage.getItem("token"),
  };
  const tenantId = getSelectedTenantId();
  if (tenantId) {
    headers["X-Tenant-Id"] = tenantId;
  }
  return headers;
};

const queriedTokens = {};
const currentPageNum = {};
const currentFiler = {};

/**
 * Helper: Capture HTTP status code before parsing JSON
 * @param {Response} res - Fetch response
 * @returns {Promise} Promise resolving to {status, json}
 */
const captureStatusAndParseJson = (res) => {
  const status = res.status;
  return res.json().then((json) => ({ status, json }));
};

/**
 * Helper: Validate response and throw error if needed
 * @param {number} status - HTTP status code
 * @param {Object} json - Response JSON
 * @returns {Object} json if valid
 * @throws {Error} if response indicates error
 */
const validateResponse = (status, json) => {
  if (
    json.type === "exception" ||
    json.type === "error" ||
    json.type === "Error"
  ) {
    const error = new Error(json.message || "An error occurred");
    error.status = status;
    error.statusCode = status;
    throw error;
  }
  return json;
};

/**
 * Helper: Ensure error has status code
 * @param {Error} error - Error object
 * @returns {Error} Error with status code
 */
const ensureErrorStatus = (error) => {
  if (!error.status && !error.statusCode) {
    error.status = 500;
    error.statusCode = 500;
  }
  return error;
};

/**
 * Helper: Standard error handler
 * @param {Error} error - Error object
 * @throws {Error} Error with guaranteed status code
 */
const handleError = (error) => {
  throw ensureErrorStatus(error);
};

const dataProvider = {
  //API call to get entire list of users
  //  GET users/
  getList: (resource, params) => {
    const { page, perPage } = params.pagination;

    if (currentFiler[resource] === undefined) {
      currentFiler[resource] = {};
    }

    if (queriedTokens[resource] === undefined) {
      queriedTokens[resource] = {};
    }

    // if filter changes, reset page number and clear all page tokens
    if (
      JSON.stringify(currentFiler[resource]) !== JSON.stringify(params.filter)
    ) {
      // clear all page tokens
      queriedTokens[resource] = {};
    }

    const url = `${apiUrl}/${resource}?page=${page}&perPage=${perPage}&filter=${JSON.stringify(params.filter)}`;
    const pageToken =
      page > 1 && queriedTokens[resource][page - 1]
        ? queriedTokens[resource][page - 1]
        : null;

    const token = localStorage.getItem("token");

    if (!token) {
      return Promise.resolve({
        data: [],
        pageInfo: { hasNextPage: false, hasPreviousPage: false },
      });
    }

    return fetch(url, {
      method: "POST",
      body: pageToken,
      headers: getHeaders(),
    })
      .then(captureStatusAndParseJson)
      .then(({ status, json }) => {
        validateResponse(status, json);

        currentPageNum[resource] = page;
        currentFiler[resource] = params.filter;
        if (queriedTokens[resource] === undefined) {
          queriedTokens[resource] = {};
        }
        queriedTokens[resource][page] = json.PaginationToken;

        return {
          data: json.data,
          pageInfo: {
            hasPreviousPage: page > 1 ? true : false,
            ...(json.PaginationToken && { hasNextPage: true }),
          },
          ...(json.total && { total: json.total }),
        };
      })
      .catch(handleError);
  },
  getOne: (resource, params) => {
    const url = `${apiUrl}/${resource}/${params.id}`;
    return fetch(url, {
      headers: getHeaders(),
    })
      .then(captureStatusAndParseJson)
      .then(({ status, json }) => {
        validateResponse(status, json);
        return { data: json.data };
      })
      .catch(handleError);
  },
  delete: (resource, params) => {
    const url = `${apiUrl}/${resource}/${params.id}`;
    return fetch(url, {
      method: "DELETE",
      headers: getHeaders(),
    })
      .then(captureStatusAndParseJson)
      .then(({ status, json }) => {
        validateResponse(status, json);
        return { data: json.data };
      })
      .catch(handleError);
  },
  deleteOne: (resource, params) => {
    const url = `${apiUrl}/${resource}/${params.id}`;
    return fetch(url, {
      method: "DELETE",
      headers: getHeaders(),
    })
      .then(captureStatusAndParseJson)
      .then(({ status, json }) => {
        validateResponse(status, json);
        return { data: json.data };
      })
      .catch(handleError);
  },
  deleteMany: (resource, params) => {
    const url = `${apiUrl}/${resource}`;
    return fetch(url, {
      method: "DELETE",
      body: JSON.stringify(params),
      headers: getHeaders(),
    })
      .then(captureStatusAndParseJson)
      .then(({ status, json }) => {
        validateResponse(status, json);
        return { data: json.data };
      })
      .catch(handleError);
  },
  update: (resource, params) => {
    const url = `${apiUrl}/${resource}/${params.id}`;
    return fetch(url, {
      method: "PUT",
      body: JSON.stringify(params),
      headers: getHeaders(),
    })
      .then(captureStatusAndParseJson)
      .then(({ status, json }) => {
        validateResponse(status, json);
        return { data: json.data };
      })
      .catch(handleError);
  },
  updateOne: (resource, params) => {
    const url = `${apiUrl}/${resource}/${params.id}`;
    return fetch(url, {
      method: "PUT",
      body: JSON.stringify(params),
      headers: getHeaders(),
    })
      .then(captureStatusAndParseJson)
      .then(({ status, json }) => {
        validateResponse(status, json);
        return { data: json.data };
      })
      .catch(handleError);
  },
  updateMany: (resource, params) => {
    const url = `${apiUrl}/${resource}`;
    return fetch(url, {
      method: "PUT",
      body: JSON.stringify(params),
      headers: getHeaders(),
    })
      .then(captureStatusAndParseJson)
      .then(({ status, json }) => {
        validateResponse(status, json);
        return { data: json.data };
      })
      .catch(handleError);
  },
  create: (resource, params) => {
    const url = `${apiUrl}/${resource}`;
    return fetch(url, {
      method: "POST",
      body: JSON.stringify(params),
      headers: getHeaders(),
    })
      .then(captureStatusAndParseJson)
      .then(({ status, json }) => {
        validateResponse(status, json);
        // Handle successful responses
        if (json.data) {
          return { data: json.data };
        }
        // Fallback: if no data field, wrap the whole response
        return { data: json };
      })
      .catch(handleError);
  },
  getMany: (resource, params) => {
    return Promise.all(
      params.ids.map((id) =>
        dataProvider.getOne(resource, { id }).catch(() => ({ data: { id } }))
      )
    ).then((results) => ({
      data: results.map((r) => r.data),
    }));
  },
  getManyReference: (resource, params) => {
    const { page, perPage } = params.pagination;
    const { field, order } = params.sort;

    // Build filter: combine existing filter with target reference
    // e.g., for tenants referencing org_id, filter by org_id: "testorg2"
    const filter = {
      ...params.filter,
      [params.target]: params.id,
    };

    // Reuse getList with the enhanced filter
    return dataProvider.getList(resource, {
      pagination: { page, perPage },
      sort: { field, order },
      filter,
    });
  },
};

export default dataProvider;
