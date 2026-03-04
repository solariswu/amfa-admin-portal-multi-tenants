import * as React from "react";
import { useState, useEffect } from "react";
import { Create, Form, SaveButton, TextInput, AutocompleteArrayInput, BooleanInput, usePermissions } from "react-admin";
import { Grid, Typography, Avatar, CssBaseline, CircularProgress } from '@mui/material';
import RedeemIcon from '@mui/icons-material/Redeem';

import { validatePhoneNumber } from "../utils/validation";
import awsmobile from "../aws-export";

const apiUrl = awsmobile.aws_backend_api_url;

export const AdminCreate = () => {
    const [groupChoices, setGroupChoices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const { permissions } = usePermissions();

    useEffect(() => {
        const fetchAvailableGroups = async () => {
            try {
                const token = localStorage.getItem('token');
                if (!token) {
                    throw new Error('No authentication token found');
                }

                console.log('Fetching available groups from backend...');
                const response = await fetch(
                    `${apiUrl}/admins?getAvailableGroups=true`,
                    {
                        headers: {
                            'Authorization': token,
                            'Content-Type': 'application/json',
                        }
                    }
                );

                if (!response.ok) {
                    throw new Error(`Failed to fetch groups: ${response.status}`);
                }

                const data = await response.json();
                console.log('Available groups response:', data);

                // Backend returns { data: { groups: [...] } }
                const groups = data.data?.groups || [];
                const choices = groups.map(g => ({ id: g, name: g }));

                console.log('Available group choices:', choices);
                setGroupChoices(choices);
            } catch (err) {
                console.error('Error fetching available groups:', err);
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchAvailableGroups();
    }, []);

    const getHelpText = () => {
        if (!permissions) return 'Select user Role';

        switch (permissions.roleType) {
            case 'SA':
                return 'As Super Admin, you can assign any SPA or TA role';
            case 'SPA':
                return `As ${permissions.roles[0]}, you can assign your own SPA role or any TA role`;
            case 'TA':
                return `As Tenant Admin, you can only assign your own TA role(s)`;
            default:
                return 'Select user Role';
        }
    };

    return (
        <Create title="Invite User" redirect="show">
            <CssBaseline />
            <div style={{
                margin: 8,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
            }}>
                <Avatar>
                    <RedeemIcon />
                </Avatar>
                <div style={{
                    paddingBottom: "4em",
                }} >

                    <Typography component="h1" variant="h5">
                        Invite Admin
                    </Typography>
                </div>
                <Form>
                    <Grid container spacing={2}>
                        <Grid item xs={12} sm={5} md={5} lg={4}>
                            <TextInput
                                variant="outlined"
                                required
                                fullWidth
                                label="Email Address"
                                type="email"
                                source="email"
                                autoComplete="email"
                                parse={(v) => v ? v.toLowerCase() : ''}
                            />
                        </Grid>
                        <Grid item xs={0} sm={6} md={6} lg={8} />
                        <Grid item xs={12} sm={5} md={5} lg={4}>
                            <TextInput
                                fullWidth
                                label="First Name"
                                source="given_name"
                                required
                            />
                        </Grid>
                        <Grid item xs={12} sm={5} md={5} lg={4}>
                            <TextInput
                                fullWidth
                                label="Last Name"
                                source="family_name"
                                required
                            />
                        </Grid>
                        <Grid item xs={0} sm={1} md={1} lg={0} />
                        <Grid item xs={12} sm={5} md={5} lg={4}>
                            <TextInput
                                label="SMS Phone Number"
                                fullWidth
                                source="phone_number"
                                validate={validatePhoneNumber}
                            />
                        </Grid>
                        <Grid item xs={12} sm={5} md={5} lg={4}>
                            <TextInput
                                fullWidth
                                source="locale"
                                label="Location/Address"
                            />
                        </Grid>
                        <Grid item xs={0} sm={1} md={1} lg={0} />
                        <Grid item xs={12} sm={6} lg={4}>
                            {loading ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <CircularProgress size={20} />
                                    <Typography variant="body2">Loading available groups...</Typography>
                                </div>
                            ) : error ? (
                                <Typography color="error" variant="body2">
                                    Error loading groups: {error}
                                </Typography>
                            ) : (
                                <AutocompleteArrayInput
                                    label="Admin Type"
                                    source="groups"
                                    choices={groupChoices}
                                    isRequired={true}
                                    disabled={loading}
                                    helperText={getHelpText()}
                                />
                            )}
                        </Grid>
                        <Grid item xs={12}>
                            <BooleanInput
                                source="notify"
                                label="Send an invitation email to user now"
                                fullWidth
                                defaultValue={true}
                            />
                        </Grid>
                    </Grid>
                    <Grid container justify="flex-end">
                        <Grid item xs={4} >
                            <SaveButton
                                label="Invite"
                            />
                        </Grid>
                    </Grid>
                </Form>
            </div>
            <CssBaseline />
        </Create >
    );
}
