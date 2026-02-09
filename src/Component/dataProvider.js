import awsmobile from '../aws-export';

const apiUrl = awsmobile.aws_backend_api_url;

const queriedTokens = {};
const currentPageNum = {};
const currentFiler = {};

const dataProvider = {
    //API call to get entire list of users
    //  GET users/
    getList: (resource, params) => {
        const { page, perPage } = params.pagination;

        if (currentFiler[resource] === undefined) {
            currentFiler[resource] = {}
        }

        if (queriedTokens[resource] === undefined) {
            queriedTokens[resource] = {}
        }

        // if filter changes, reset page number and clear all page tokens
        if (JSON.stringify(currentFiler[resource]) !== JSON.stringify(params.filter)) {
            // clear all page tokens
            queriedTokens[resource] = {};
        }

        const url = `${apiUrl}/${resource}?page=${page}&perPage=${perPage}&filter=${JSON.stringify(params.filter)}`;
        const pageToken = page > 1 && queriedTokens[resource][page - 1] ? queriedTokens[resource][page - 1] : null;

        const token = localStorage.getItem('token');

        if (!token) {
            return Promise.resolve({ data: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } });
            // return Promise.reject(new Error('No token'));
        }
        
        return fetch(url, {
            method: 'POST',
            body: pageToken,
            headers: {
                Authorization: token,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            }
        }).then(res => res.json())
            .then(json => {
                if (json.type === 'exception' || json.type === 'Error') {
                    throw new Error(json.message);
                }
                currentPageNum[resource] = page;
                currentFiler[resource] = params.filter;
                if (queriedTokens[resource] === undefined) {
                    queriedTokens[resource] = {}
                }
                queriedTokens[resource][page] = json.PaginationToken;

                return {
                  data: json.data,
                  // pageInfo: {
                  //     hasPreviousPage: false,
                  //     hasNextPage: true,
                  // }
                  pageInfo: {
                    hasPreviousPage: page > 1 ? true : false,
                    ...(json.PaginationToken && { hasNextPage: true }),
                  },
                  ...(json.total && { total: json.total }),
                };
            })
    },
    getOne: (resource, params) => {
        const url = `${apiUrl}/${resource}/${params.id}`;
        return fetch(url, {
            headers: {
                Authorization: localStorage.getItem('token'),
                'Content-Type': 'application/json',
                Accept: 'application/json',
            }
        })
            .then(res => res.json())
            .then(json => ({ data: json.data }))
    },
    delete: (resource, params) => {
        const url = `${apiUrl}/${resource}/${params.id}`;
        return fetch(url, {
            method: 'DELETE',
            headers: {
                Authorization: localStorage.getItem('token'),
                'Content-Type': 'application/json',
                Accept: 'application/json',
            }
        })
            .then(res => res.json())
            .then(json => ({ data: json.data }))
    },
    deleteOne: (resource, params) => {
        const url = `${apiUrl}/${resource}/${params.id}`;
        return fetch(url, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: localStorage.getItem('token')
            }
        })
            .then(res => res.json())
            .then(json => ({ data: json.data }))
    },
    deleteMany: (resource, params) => {
        const url = `${apiUrl}/${resource}`;
        return fetch(url, {
            method: 'DELETE',
            body: JSON.stringify(params),
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: localStorage.getItem('token')
            }
        }).then(res => res.json())
            .then(json => {
                if (json.type === 'exception' || json.type === 'Error') {
                    throw new Error(json.message)
                }
                else {
                    return ({ data: json.data })
                }
            })
    },
    update: (resource, params) => {
        const url = `${apiUrl}/${resource}/${params.id}`;
        return fetch(url, {
            method: 'PUT',
            body: JSON.stringify(params),
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: localStorage.getItem('token')
            }
        }).then(res => res.json())
            .then(json => {
                if (json.type === 'exception' || json.type === 'Error') {
                    return Promise.reject(new Error(json.message))
                }
                else {
                    return ({ data: json.data })
                }
            })
    },
    updateOne: (resource, params) => {
        const url = `${apiUrl}/${resource}/${params.id}`;
        return fetch(url, {
            method: 'PUT',
            body: JSON.stringify(params),
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: localStorage.getItem('token')
            }
        }).then(res => res.json())
            .then(json => {
                if (json.type === 'exception' || json.type === 'Error') {
                    throw new Error(json.message)
                }
                else {
                    return ({ data: json.data })
                }
            })
    },
    updateMany: (resource, params) => {
        const url = `${apiUrl}/${resource}`;
        return fetch(url, {
            method: 'PUT',
            body: JSON.stringify(params),
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: localStorage.getItem('token')
            }
        }).then(res => res.json())
            .then(json => ({ data: json.data }))
    },
    create: (resource, params) => {
        const url = `${apiUrl}/${resource}`;
        return fetch(url, {
            method: 'POST',
            body: JSON.stringify(params),
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: localStorage.getItem('token')
            }
        }).then(res => res.json())
            .then(json => {
                if (json.type === 'exception' || json.type === 'Error') {
                    throw new Error(json.message)
                }
                else {
                    if (json.data && json.data.statusCode && json.data.statusCode === 409) {
                        const body = JSON.parse(json.data.body)
                        throw new Error(body?.data)
                    }
                    else {
                        return ({ data: json.data })
                    }
                }
            })
    }
}

export default dataProvider;
