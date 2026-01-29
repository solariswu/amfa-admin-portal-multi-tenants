import * as React from "react";
import { Create, Form, SaveButton, TextInput, useGetList, AutocompleteArrayInput, BooleanInput } from "react-admin";
import { Grid, Typography, Avatar, CssBaseline } from '@mui/material';
import RedeemIcon from '@mui/icons-material/Redeem';

import { validatePhoneNumber } from "../utils/validation";

export const TenantCreate = () => {
    const { data } = useGetList(
        'groups',
        {
            pagination: { page: 1, perPage: 60 },
            sort: { field: 'createdAt', order: 'DESC' }
        }
    );

    const groupChoices = data ? data.map(item => ({ id: item.id, name: item.group })) : [];

    return (
        <Create title="Add Tenant" redirect="show">
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
                        Invite User
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
                                fullWidth
                                source="phone_number"
                                validate={validatePhoneNumber}
                            />
                        </Grid>
                        <Grid item xs={12} sm={5} md={5} lg={4}>
                            <TextInput
                                fullWidth
                                source="location"
                                label="Location/Address"
                            />
                        </Grid>
                        <Grid item xs={0} sm={1} md={1} lg={0} />
                        <Grid item xs={12} sm={6} lg={4}>
                            <AutocompleteArrayInput
                                label="User Groups"
                                source="groups"
                                choices={groupChoices}
                                isRequired={true}
                                defaultValue={['user']}
                            />
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