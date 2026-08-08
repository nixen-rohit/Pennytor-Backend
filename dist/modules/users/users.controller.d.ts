import { UsersService } from './users.service';
export declare class UsersController {
    private readonly usersService;
    constructor(usersService: UsersService);
    approveUser(id: string): Promise<{
        message: string;
        clientId: string | null;
    }>;
}
